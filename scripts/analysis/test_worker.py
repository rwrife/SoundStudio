"""Local contract/DSP/decoder tests; never installs packages or downloads models."""

import importlib.util
import io
import json
import math
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest import mock
import uuid

import worker


ROOT = Path(__file__).resolve().parents[2]
HAS_CORE = all(importlib.util.find_spec(name) is not None for name in ("av", "numpy", "librosa", "soundfile", "scipy"))


def options(**updates):
    value = {"start": 0, "end": 4, "stems": [], "lyrics": "none",
             "wordTimestamps": False, "notes": False, "captions": False}
    value.update(updates)
    return value


def midi_fixture(start=0.1, end=1.0, *, bends=None, controls=None):
    note = SimpleNamespace(start=start, end=end, pitch=60, velocity=80)
    instrument = SimpleNamespace(notes=[note], pitch_bends=bends or [], control_changes=controls or [])
    return SimpleNamespace(
        instruments=[instrument], resolution=220,
        time_to_tick=lambda seconds: round(float(seconds) * 440),
        tick_to_time=lambda ticks: ticks / 440,
    )


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / ".runtime" / f"worker-tests-{uuid.uuid4().hex}"
        self.root.mkdir(parents=True)
        self.models = self.root / "models"
        self.models.mkdir()
        self.events = []
        self.emitter = mock.patch.object(worker, "emit", side_effect=self.events.append)
        self.emitter.start()

    def tearDown(self):
        self.emitter.stop()
        shutil.rmtree(self.root)

    def folder(self, name):
        path = self.root / name
        path.mkdir()
        return path

    def invoke(self, request):
        return subprocess.run(
            [sys.executable, "-u", str(Path(worker.__file__).resolve())],
            input=json.dumps(request), text=True, capture_output=True,
            cwd=ROOT, timeout=180, encoding="utf-8",
        )


class ContractTests(WorkspaceTest):
    def test_exact_options_and_finite_timestamps(self):
        self.assertEqual(worker.validate_options(options()), options())
        invalid = [
            options(start=-1), options(end=601), options(end=0),
            options(start=math.nan), options(end=math.inf), options(notes=1),
            options(stems=["vocals", "vocals"]), options(stems=["../../outside"]),
            options(stems=[["vocals"]]), options(lyrics="large"), {**options(), "extra": True},
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(worker.WorkerError):
                worker.validate_options(value)

    def test_metadata_contract(self):
        value = {"duration": 1.25, "sampleRate": 44100, "channels": 2, "peaks": [0.0, 0.8, 1.0]}
        worker.validate_metadata(value)
        for patch in ({"peaks": []}, {"peaks": [math.nan]}, {"duration": 0}, {"duration": 1801},
                      {"sampleRate": True}, {"channels": 3}, {"peaks": [1.01]}):
            with self.subTest(patch=patch), self.assertRaises(worker.WorkerError):
                worker.validate_metadata({**value, **patch})

    def test_local_only_paths(self):
        for value in ("relative.wav", "https://example.invalid/a.wav", "\\\\server\\share\\a.wav"):
            with self.subTest(path=value), self.assertRaises(worker.WorkerError):
                worker.local_path(value)
        for name in ("../escape", "/absolute", "foo\\bar", "file:stream", "a//b"):
            with self.subTest(name=name), self.assertRaises(worker.WorkerError):
                worker.child_file(self.root, name)
        self.assertEqual(worker.local_path(str(self.root), directory=True), self.root)

    def test_network_connections_and_dns_denied_and_restored(self):
        original = socket.create_connection
        previous = os.environ.get("HF_HUB_OFFLINE")
        with worker.offline():
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            for operation in (lambda: socket.create_connection(("127.0.0.1", 1)),
                              lambda: socket.getaddrinfo("example.invalid", 443)):
                with self.assertRaises(worker.WorkerError):
                    operation()
            with socket.socket() as connection:
                with self.assertRaises(worker.WorkerError):
                    connection.connect(("127.0.0.1", 1))
        self.assertIs(socket.create_connection, original)
        self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), previous)

    def test_external_decoder_io_rejected(self):
        with self.assertRaises(worker.WorkerError):
            worker.reject_external_io("https://example.invalid/audio", 0, {})

    def test_missing_optional_profile_fails_before_dsp_or_audio_read(self):
        output = self.folder("job")
        with mock.patch.object(worker, "musical_analysis") as dsp, mock.patch.object(worker, "read_excerpt") as read:
            with self.assertRaisesRegex(worker.WorkerError, "not installed"):
                worker.analyze(self.root / "reference.wav", output, self.models, options(stems=["vocals"]))
            dsp.assert_not_called()
            read.assert_not_called()
        self.assertEqual(list(output.iterdir()), [])

    def test_manifest_wrong_revision_and_incomplete_files_fail(self):
        directory = self.models / "lyrics-tiny"
        directory.mkdir()
        manifest = {"profile": "lyrics-tiny", "model": worker.PROFILES["lyrics-tiny"]["repo"],
                    "revision": "wrong", "files": {}}
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(worker.WorkerError, "revision"):
            worker.read_manifest(self.models, "lyrics-tiny")
        manifest["revision"] = worker.PROFILES["lyrics-tiny"]["revision"]
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(worker.WorkerError, "incomplete"):
            worker.read_manifest(self.models, "lyrics-tiny")

    def test_malformed_requests_have_nonzero_exit_and_no_result(self):
        for payload in ('{}', '{"command":NaN}', '{"command":"diagnose"}\n{}', '[]'):
            process = subprocess.run(
                [sys.executable, "-u", str(Path(worker.__file__).resolve())],
                input=payload, text=True, capture_output=True, cwd=ROOT, timeout=30,
            )
            self.assertNotEqual(process.returncode, 0)
            self.assertEqual(process.stdout, "")
            self.assertTrue(process.stderr.strip())
            self.assertNotIn(str(self.root), process.stderr)

    def test_caption_memory_preflight_is_actionable(self):
        memory = mock.Mock(total=32 * 1024**3, available=10 * 1024**3)
        module = mock.Mock()
        module.virtual_memory.return_value = memory
        with mock.patch.dict(sys.modules, {"psutil": module}):
            with self.assertRaisesRegex(worker.WorkerError, "40 GiB.*35 GiB"):
                worker.check_caption_memory()
            memory.total, memory.available = 64 * 1024**3, 42 * 1024**3
            worker.check_caption_memory()

    def test_download_integrity_is_checked_before_model_can_publish(self):
        data = b"not a model"
        response = io.BytesIO(data)
        response.geturl = lambda: "https://example.invalid/model"
        with mock.patch("urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(worker.WorkerError, "integrity"):
                worker.download_file("https://example.invalid/model", self.root / "model", len(data),
                                     "0" * 64, "sha256", lambda _: None)

    def test_missing_dependency_names_are_actionable_without_paths(self):
        detail = worker.safe_error(ModuleNotFoundError("missing", name="pkg_resources"))
        self.assertIn("pkg_resources", detail)
        self.assertIn("setuptools==75.8.2", detail)
        self.assertIn("_ctranslate2", worker.safe_error(ImportError("DLL unavailable", name="_ctranslate2")))
        private_name = str(self.root / "private.py")
        self.assertNotIn(private_name, worker.safe_error(ImportError("missing", name=private_name)))
        wrapped = RuntimeError("model wrapper error")
        wrapped.__cause__ = ModuleNotFoundError("missing", name="pkg_resources")
        self.assertIn("pkg_resources", worker.safe_error(wrapped))

    def test_whisper_boundary_adjustments_preserve_raw_evidence(self):
        segment = SimpleNamespace(start=-0.02, end=4.02, text="boundary text", words=None)
        rows, warnings, evidence = worker.collect_lyrics([segment], options(start=20, end=24), lambda *args: None)
        self.assertEqual(rows, [{"start": 20.0, "end": 24.0, "text": "boundary text"}])
        self.assertTrue(any("40 ms" in warning for warning in warnings))
        self.assertEqual(evidence["timestampAdjustments"], [
            {"segment": 0, "word": None, "raw": [-0.02, 4.02], "normalized": [0.0, 4.0]},
        ])

    def test_whisper_rejects_significant_nonfinite_and_reversed_timestamps(self):
        for start, end in ((-0.1, 1), (0, 4.1), (math.nan, 1), (0, math.inf), (2, 1), ("0", 1), (False, 1)):
            with self.subTest(start=start, end=end):
                segment = SimpleNamespace(start=start, end=end, text="invalid", words=None)
                with self.assertRaises(worker.WorkerError):
                    worker.collect_lyrics([segment], options(), lambda *args: None)

    def test_whisper_preserves_zero_duration_words_instead_of_dropping_text(self):
        word = SimpleNamespace(start=1.0, end=1.0, word="uncertain")
        segment = SimpleNamespace(start=1.0, end=1.0, text="uncertain", words=[word])
        rows, warnings, evidence = worker.collect_lyrics(
            [segment], options(start=20, end=24, wordTimestamps=True), lambda *args: None)
        self.assertEqual(rows, [{"start": 21.0, "end": 21.0, "text": "uncertain"}])
        self.assertTrue(any("zero-duration" in warning for warning in warnings))
        self.assertEqual(evidence["zeroDurationEntries"], 1)

    def test_whisper_does_not_silently_truncate_boundary_evidence(self):
        segments = [SimpleNamespace(start=-0.02, end=1, text="boundary", words=None) for _ in range(17)]
        with self.assertRaisesRegex(worker.WorkerError, "too many out-of-bounds"):
            worker.collect_lyrics(segments, options(), lambda *args: None)

    def test_basic_pitch_boundary_adjustments_preserve_raw_notes(self):
        midi = midi_fixture(-0.01, 4.01)
        warnings, evidence = worker.normalize_note_timings(midi, 4)
        self.assertTrue(any("23.22 ms" in warning for warning in warnings))
        self.assertEqual(evidence["timestampAdjustments"], [{
            "kind": "note", "instrument": 0, "event": 0, "raw": [-0.01, 4.01],
            "normalized": [0.0, 4], "pitch": 60, "velocity": 80,
        }])
        self.assertEqual((midi.instruments[0].notes[0].start, midi.instruments[0].notes[0].end), (0.0, 4))

    def test_basic_pitch_rejects_significant_nonfinite_and_reversed_times(self):
        for start, end in ((-0.1, 1), (0, 4.1), (math.nan, 1), (0, math.inf), (2, 1), (1, 1), ("0", 1), (False, 1)):
            with self.subTest(start=start, end=end), self.assertRaises(worker.WorkerError):
                worker.normalize_note_timings(midi_fixture(start, end), 4)
        for field in ("bends", "controls"):
            with self.subTest(field=field), self.assertRaises(worker.WorkerError):
                worker.normalize_note_timings(midi_fixture(**{field: [SimpleNamespace(time=8)]}), 4)

    def test_basic_pitch_midi_endpoint_rounding_is_bounded_and_recorded(self):
        midi = midi_fixture(0.1, 4.0015)
        warnings, evidence = worker.normalize_note_timings(midi, 4.0015)
        self.assertEqual(midi.instruments[0].notes[0].end, 4.0)
        self.assertEqual(evidence["timestampAdjustments"][0]["raw"], [0.1, 4.0015])
        self.assertTrue(warnings)

    def test_basic_pitch_does_not_drop_outside_notes_or_truncate_evidence(self):
        with self.assertRaisesRegex(worker.WorkerError, "no duration inside"):
            worker.normalize_note_timings(midi_fixture(4.001, 4.01), 4)
        midi = midi_fixture(-0.01, 1)
        midi.instruments[0].notes = [SimpleNamespace(start=-0.01, end=1, pitch=60, velocity=80) for _ in range(13)]
        with self.assertRaisesRegex(worker.WorkerError, "too many boundary"):
            worker.normalize_note_timings(midi, 4)


@unittest.skipUnless(HAS_CORE, "Run with the managed Python environment after installing requirements-core.txt.")
class DecoderAndDSPTests(WorkspaceTest):
    def write_audio(self, name, duration=4, channels=1, rate=44100, subtype="PCM_16", kind="tone"):
        import numpy as np
        import soundfile as sf
        times = np.arange(round(duration * rate), dtype=np.float32) / rate
        audio = np.zeros_like(times)
        if kind == "tone":
            audio = sum(0.12 * np.sin(2 * np.pi * frequency * times) for frequency in (261.6256, 329.6276, 391.9954))
        elif kind == "pulses":
            for start in range(0, len(audio), rate // 2):
                length = min(rate // 40, len(audio) - start)
                audio[start:start + length] = np.exp(-np.arange(length) / (rate * 0.005))
        if channels > 1:
            audio = np.repeat(audio[:, None], channels, axis=1)
        path = self.root / name
        sf.write(path, audio, rate, subtype=subtype)
        return path

    def test_whisper_numpy_float_timestamps_preserve_valid_values(self):
        import numpy as np
        words = [
            SimpleNamespace(start=np.float64(1.42), end=np.float64(2.1), word="first"),
            SimpleNamespace(start=np.float64(2.1), end=np.float64(2.42), word="second"),
        ]
        segment = SimpleNamespace(start=np.float64(1.42), end=np.float64(2.42), text="first second", words=words)
        rows, warnings, evidence = worker.collect_lyrics(
            [segment], options(start=20, end=40, wordTimestamps=True), lambda *args: None)
        self.assertEqual(rows, [
            {"start": 21.42, "end": 22.1, "text": "first"},
            {"start": 22.1, "end": 22.42, "text": "second"},
        ])
        self.assertEqual(warnings, [])
        self.assertEqual(evidence["timestampAdjustments"], [])
        json.dumps(rows, allow_nan=False)

    def test_basic_pitch_numpy_timestamps_preserve_valid_notes(self):
        import numpy as np
        start, end = np.float64(0.011609977324263039), np.float64(0.8126984126984127)
        midi = midi_fixture(start, end, bends=[SimpleNamespace(time=np.float64(0.05))],
                            controls=[SimpleNamespace(time=np.float64(0.06))])
        warnings, evidence = worker.normalize_note_timings(midi, 20)
        note = midi.instruments[0].notes[0]
        self.assertEqual((note.start, note.end), (float(start), float(end)))
        self.assertIs(type(note.start), float)
        self.assertIs(type(note.end), float)
        self.assertEqual(evidence["predictedNoteCount"], 1)
        self.assertEqual(evidence["timestampAdjustments"], [])
        self.assertEqual(warnings, [])
        json.dumps(evidence, allow_nan=False)

    def test_mono_stereo_resampling_and_peak_contract(self):
        import soundfile as sf
        for rate, channels, target in ((22050, 1, 44100), (48000, 2, 48000), (96000, 2, 48000)):
            with self.subTest(rate=rate, channels=channels):
                source = self.write_audio(f"{rate}.wav", duration=0.25, channels=channels, rate=rate)
                output = self.folder(f"import-{rate}")
                with worker.offline():
                    metadata = worker.import_audio(source, output)
                worker.validate_metadata(metadata)
                self.assertEqual(metadata["channels"], channels)
                self.assertEqual(metadata["sampleRate"], target)
                self.assertAlmostEqual(metadata["duration"], 0.25, places=4)
                info = sf.info(output / "reference.wav")
                self.assertEqual(info.subtype, "PCM_16")
                self.assertEqual(info.samplerate, target)
                self.assertEqual([path.name for path in output.iterdir()], ["reference.wav"])

    def test_flac_and_ogg_decode_with_bundled_ffmpeg(self):
        for extension, subtype in (("flac", "PCM_16"), ("ogg", "VORBIS")):
            with self.subTest(extension=extension):
                source = self.write_audio(f"source.{extension}", duration=0.5, subtype=subtype)
                result = worker.import_audio(source, self.folder(extension))
                worker.validate_metadata(result)
                self.assertAlmostEqual(result["duration"], 0.5, delta=0.03)

    def test_mp3_and_m4a_roundtrip_through_bundled_codecs(self):
        import av
        import numpy as np
        for extension, container_format, codec in (("mp3", "mp3", "libmp3lame"), ("m4a", "ipod", "aac")):
            with self.subTest(extension=extension):
                source = self.root / f"source.{extension}"
                with av.open(str(source), mode="w", format=container_format) as container:
                    stream = container.add_stream(codec, rate=44100)
                    stream.layout = "mono"
                    samples = (0.25 * np.sin(2 * np.pi * 440 * np.arange(22050) / 44100)).astype("float32")
                    frame = av.AudioFrame.from_ndarray(samples[None, :], format="fltp", layout="mono")
                    frame.sample_rate = 44100
                    for packet in stream.encode(frame):
                        container.mux(packet)
                    for packet in stream.encode(None):
                        container.mux(packet)
                result = worker.import_audio(source, self.folder(extension))
                worker.validate_metadata(result)
                self.assertAlmostEqual(result["duration"], 0.5, delta=0.06)

    def test_multichannel_and_invalid_rate_rejected(self):
        for name, channels, rate in (("multichannel", 3, 44100), ("low-rate", 1, 4000), ("high-rate", 1, 200000)):
            with self.subTest(name=name):
                source = self.write_audio(f"{name}.wav", duration=0.1, channels=channels, rate=rate)
                output = self.folder(name)
                with self.assertRaises(worker.WorkerError):
                    worker.import_audio(source, output)
                self.assertEqual(list(output.iterdir()), [])

    def test_disguised_playlist_and_invalid_bytes_rejected(self):
        for name, content in (
            ("playlist.wav", b"#EXTM3U\nhttps://example.invalid/private.wav\n"),
            ("concat.mp3", b"ffconcat version 1.0\nfile 'https://example.invalid/private.wav'\n"),
            ("invalid.m4a", b"not audio"),
            ("unsupported.txt", b"RIFF"),
        ):
            source = self.root / name
            source.write_bytes(content)
            output = self.folder(name + "-output")
            with worker.offline(), self.assertRaises(Exception):
                worker.import_audio(source, output)
            self.assertEqual(list(output.iterdir()), [])

    def test_nonfinite_float_audio_rejected(self):
        import numpy as np
        import soundfile as sf
        source = self.root / "nan.wav"
        sf.write(source, np.array([0, np.nan, np.inf, -np.inf], dtype=np.float32), 44100, subtype="FLOAT")
        output = self.folder("nonfinite")
        with self.assertRaisesRegex(worker.WorkerError, "non-finite"):
            worker.import_audio(source, output)
        self.assertEqual(list(output.iterdir()), [])

    def test_decoded_duration_limit_and_empty_audio_rejected(self):
        source = self.write_audio("long.wav", duration=2)
        output = self.folder("long")
        with mock.patch.object(worker, "MAX_DURATION", 1), self.assertRaisesRegex(worker.WorkerError, "limit"):
            worker.import_audio(source, output)
        self.assertEqual(list(output.iterdir()), [])
        empty = self.write_audio("empty.wav", duration=0)
        with self.assertRaises(Exception):
            worker.import_audio(empty, output)
        self.assertEqual(list(output.iterdir()), [])

    def test_decoded_sample_count_limits_audio_without_duration_metadata(self):
        import av
        real_open = av.open
        source = self.write_audio("unreported-duration.wav", duration=2)
        output = self.folder("decoded-limit")

        class NoDurationContainer:
            def __init__(self, *args, **kwargs):
                self.container = real_open(*args, **kwargs)
                self.original = self.container.streams.audio[0]
                self.streams = SimpleNamespace(audio=[SimpleNamespace(
                    codec_context=self.original.codec_context, duration=None, time_base=self.original.time_base)])

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.container.close()

            def decode(self, stream):
                return self.container.decode(self.original)

        with mock.patch.object(worker, "MAX_DURATION", 1), mock.patch("av.open", NoDurationContainer):
            with self.assertRaisesRegex(worker.WorkerError, "Decoded audio exceeds"):
                worker.import_audio(source, output)
        self.assertEqual(list(output.iterdir()), [])

    def test_silence_never_creates_semantic_or_midi_results(self):
        import numpy as np
        selected = options(start=10, end=14)
        result = worker.musical_analysis(np.zeros((4 * 44100, 1), dtype=np.float32), 44100, selected)
        worker.validate_result(result, selected)
        self.assertIsNone(result["tempo"])
        self.assertEqual(result["beats"], [])
        self.assertEqual(result["lyrics"], [])
        self.assertEqual(result["descriptions"], [])
        self.assertEqual(result["stems"], [])
        self.assertFalse(result["midi"])
        self.assertEqual(result["sections"][0]["start"], 10)
        self.assertEqual(result["sections"][0]["end"], 14)

    def test_tonal_chords_and_pulse_tempo_are_real_dsp_estimates(self):
        import soundfile as sf
        tone = self.write_audio("triad.wav", duration=12)
        audio, rate = sf.read(tone, dtype="float32", always_2d=True)
        selected = options(start=123.25, end=135.25)
        result = worker.musical_analysis(audio, rate, selected)
        worker.validate_result(result, selected)
        self.assertIn("estimate", result["key"])
        self.assertTrue(any("C major" in item["text"] for item in result["chords"]), result["chords"])
        self.assertTrue(all(123.25 <= item["time"] <= 135.25 for item in result["energy"]))
        pulse = self.write_audio("pulse.wav", duration=16, kind="pulses")
        audio, rate = sf.read(pulse, dtype="float32", always_2d=True)
        result = worker.musical_analysis(audio, rate, options(end=16))
        self.assertIsNotNone(result["tempo"])
        self.assertAlmostEqual(result["tempo"], 120, delta=8)
        self.assertGreater(len(result["beats"]), 15)

    def test_very_short_and_fractional_excerpt_stays_inside_source_bounds(self):
        import numpy as np
        selected = options(start=0.1, end=0.1001)
        result = worker.musical_analysis(np.zeros((4, 1), dtype=np.float32), 44100, selected)
        worker.validate_result(result, selected)
        selected = options(start=0.1, end=4.2)
        result = worker.musical_analysis(np.zeros((round(4.1 * 44100), 1), dtype=np.float32), 44100, selected)
        worker.validate_result(result, selected)

    def test_reference_format_and_out_of_range_excerpts_rejected(self):
        reference = self.write_audio("reference.wav", duration=1)
        with self.assertRaisesRegex(worker.WorkerError, "ends after"):
            worker.read_excerpt(reference, options(end=2))
        self.write_audio("reference.wav", duration=1, rate=22050)
        with self.assertRaisesRegex(worker.WorkerError, "not normalized"):
            worker.read_excerpt(reference, options(end=1))

    def test_import_never_overwrites_existing_reference(self):
        source = self.write_audio("source.wav", duration=0.1)
        output = self.folder("existing")
        existing = output / "reference.wav"
        existing.write_bytes(b"keep")
        with self.assertRaisesRegex(worker.WorkerError, "already exists"):
            worker.import_audio(source, output)
        self.assertEqual(existing.read_bytes(), b"keep")

    def test_partial_optional_failure_rolls_back_all_outputs(self):
        import numpy as np
        import soundfile as sf
        reference = self.write_audio("reference.wav", duration=1, kind="silence")
        output = self.folder("rollback")

        def partial_stems(audio, rate, root, scratch, selected, report):
            sf.write(scratch / "vocals.wav", np.zeros((44100, 2), dtype="float32"), 44100, subtype="PCM_16")
            return []

        with mock.patch.object(worker, "read_manifest", return_value=(self.models, {})), \
                mock.patch.object(worker, "import_profile"), \
                mock.patch.object(worker, "run_stems", side_effect=partial_stems), \
                mock.patch.object(worker, "run_lyrics", side_effect=worker.WorkerError("injected stage failure")):
            with self.assertRaisesRegex(worker.WorkerError, "injected"):
                worker.analyze(reference, output, self.models, options(end=1, stems=["vocals"], lyrics="tiny"))
        self.assertEqual(list(output.iterdir()), [])
        self.assertFalse(any(event.get("type") == "result" for event in self.events))

    def test_lyric_routing_uses_generated_vocals_rate_and_absolute_source_offset(self):
        import hashlib
        import numpy as np
        import soundfile as sf
        reference = self.write_audio("reference.wav", duration=3, rate=48000, kind="silence")
        output = self.folder("vocal-routing")
        selected = options(start=1, end=2, stems=["vocals"], lyrics="tiny", wordTimestamps=True)

        def stems(audio, rate, root, scratch, requested, report):
            self.assertEqual(rate, 48000)
            sf.write(scratch / "vocals.wav", np.full((44100, 2), 0.25, dtype="float32"), 44100, subtype="PCM_16")
            return []

        def lyrics(audio, rate, root, requested, report):
            self.assertEqual(rate, 44100)
            self.assertEqual(audio.shape, (44100, 2))
            self.assertTrue(np.all(audio == 0.25))
            self.assertEqual((requested["start"], requested["end"]), (1, 2))
            words = [SimpleNamespace(start=np.float64(0.25), end=np.float64(0.75), word="test")]
            segment = SimpleNamespace(start=0.25, end=0.75, words=words, text="test")
            return worker.collect_lyrics([segment], requested, report)

        with mock.patch.object(worker, "read_manifest", return_value=(self.models, {})), \
                mock.patch.object(worker, "import_profile"), \
                mock.patch.object(worker, "run_stems", side_effect=stems), \
                mock.patch.object(worker, "run_lyrics", side_effect=lyrics) as transcribe:
            result = worker.analyze(reference, output, self.models, selected)
        transcribe.assert_called_once()
        self.assertEqual(result["lyrics"], [{"start": 1.25, "end": 1.75, "text": "test"}])
        evidence = json.loads(next(row["details"] for row in result["provenance"] if row["stage"] == "lyrics-tiny"))
        audio_input = evidence["inputAudio"]
        self.assertEqual(audio_input["kind"], "separated-vocals")
        self.assertEqual(audio_input["sampleRate"], 44100)
        self.assertEqual(audio_input["sourceOffsetSeconds"], 1)
        self.assertEqual(audio_input["sha256"], hashlib.sha256((output / "vocals.wav").read_bytes()).hexdigest())
        self.assertEqual(audio_input["separationRevision"], worker.PROFILES["stems"]["revision"])
        self.assertTrue(any("generated vocals stem" in warning for warning in result["warnings"]))
        worker.validate_result(result, selected)

    def test_lyric_routing_without_selected_vocals_labels_original_full_mix(self):
        import numpy as np
        import soundfile as sf
        reference = self.write_audio("reference.wav", duration=3, rate=48000, kind="silence")
        for selected_stems in ([], ["drums"]):
            with self.subTest(stems=selected_stems):
                output = self.folder("mix-routing-" + str(len(selected_stems)))
                selected = options(start=1, end=2, stems=selected_stems, lyrics="tiny")

                def stems(audio, rate, root, scratch, requested, report):
                    for stem in requested:
                        sf.write(scratch / f"{stem}.wav", np.full((44100, 2), 0.5, dtype="float32"),
                                 44100, subtype="PCM_16")
                    return []

                def lyrics(audio, rate, root, requested, report):
                    self.assertEqual(rate, 48000)
                    self.assertEqual(audio.shape, (48000, 1))
                    self.assertTrue(np.all(audio == 0))
                    return worker.collect_lyrics(
                        [SimpleNamespace(start=0.25, end=0.75, words=None, text="test")], requested, report)

                with mock.patch.object(worker, "read_manifest", return_value=(self.models, {})), \
                        mock.patch.object(worker, "import_profile"), \
                        mock.patch.object(worker, "run_stems", side_effect=stems), \
                        mock.patch.object(worker, "run_lyrics", side_effect=lyrics):
                    result = worker.analyze(reference, output, self.models, selected)
                evidence = json.loads(next(row["details"] for row in result["provenance"] if row["stage"] == "lyrics-tiny"))
                self.assertEqual(evidence["inputAudio"]["kind"], "full-mix")
                self.assertEqual(evidence["inputAudio"]["sampleRate"], 48000)
                self.assertEqual(evidence["inputAudio"]["sourceOffsetSeconds"], 1)
                self.assertTrue(any("Lyric input: full mix" in warning for warning in result["warnings"]))
                self.assertEqual(result["lyrics"][0]["start"], 1.25)
                worker.validate_result(result, selected)

    def test_lyric_routing_never_falls_back_after_missing_invalid_or_failed_stems(self):
        import numpy as np
        import soundfile as sf
        reference = self.write_audio("reference.wav", duration=1, kind="silence")
        for failure in ("missing", "decode", "duration", "separation"):
            with self.subTest(failure=failure):
                output = self.folder("no-fallback-" + failure)

                def stems(audio, rate, root, scratch, requested, report):
                    if failure == "separation":
                        raise worker.WorkerError("separation failed")
                    if failure == "decode":
                        (scratch / "vocals.wav").write_bytes(b"invalid audio")
                    elif failure == "duration":
                        sf.write(scratch / "vocals.wav", np.zeros((22050, 2), dtype="float32"), 44100, subtype="PCM_16")
                    return []

                with mock.patch.object(worker, "read_manifest", return_value=(self.models, {})), \
                        mock.patch.object(worker, "import_profile"), \
                        mock.patch.object(worker, "run_stems", side_effect=stems), \
                        mock.patch.object(worker, "run_lyrics") as transcribe:
                    with self.assertRaises(worker.WorkerError):
                        worker.analyze(reference, output, self.models, options(end=1, stems=["vocals"], lyrics="tiny"))
                    transcribe.assert_not_called()
                self.assertEqual(list(output.iterdir()), [])

    def test_subprocess_diagnosis_and_end_to_end_protocol(self):
        diagnosis = self.invoke({"command": "diagnose", "models": str(self.models)})
        self.assertEqual(diagnosis.returncode, 0, diagnosis.stderr)
        diagnosed = [json.loads(line) for line in diagnosis.stdout.splitlines()]
        self.assertEqual(len(diagnosed), 1)
        value = diagnosed[0]["value"]
        self.assertEqual(set(value), {"python", "profiles"})
        self.assertEqual(len(value["profiles"]), 6)
        self.assertTrue(value["profiles"][0]["ready"], value["profiles"][0]["detail"])
        self.assertTrue(all(not profile["ready"] for profile in value["profiles"][1:]))
        source = self.write_audio("source.wav", duration=5)
        imported = self.folder("imported")
        result = self.invoke({"command": "import", "source": str(source), "output": str(imported)})
        self.assertEqual(result.returncode, 0, result.stderr)
        events = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(sum(event["type"] == "result" for event in events), 1)
        worker.validate_metadata(events[-1]["value"])
        selected = options(start=1, end=4)
        analysis = self.invoke({"command": "analyze", "source": str(imported / "reference.wav"),
                                "output": str(self.folder("analysis")), "models": str(self.models),
                                "options": selected})
        self.assertEqual(analysis.returncode, 0, analysis.stderr)
        events = [json.loads(line) for line in analysis.stdout.splitlines()]
        self.assertEqual(events[-1]["type"], "result")
        worker.validate_result(events[-1]["value"], selected)
        self.assertNotIn(str(self.root), analysis.stdout)
        self.assertEqual(len(events[-1]["value"]["provenance"]), 1)
        for event in events[:-1]:
            self.assertEqual(set(event), {"type", "progress", "stage"})
            self.assertTrue(0 <= event["progress"] <= 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
