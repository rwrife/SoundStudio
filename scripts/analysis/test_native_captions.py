"""Native adapter contracts, not evidence of model inference quality."""

import hashlib
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

import worker

native = worker.native


class NativeContracts(unittest.TestCase):
    @unittest.skipUnless(all(worker.importlib.util.find_spec(name) for name in ("numpy", "soundfile", "scipy")), "Core DSP packages are not installed")
    def test_prepared_audio_uses_real_in_bounds_source_samples(self):
        import numpy as np
        import soundfile as sf
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reference.wav"
            samples = np.sin(np.arange(31 * 44100) * (2 * math.pi * 440 / 44100)).astype("float32") * .1
            sf.write(source, samples, 44100, subtype="PCM_16")
            source_hash = native.digest(source)
            options = {"start": .12345, "end": 30.2}
            result = native.prepare(source, root, options, worker.read_excerpt)
            self.assertEqual(len(result["windows"]), 2)
            for item in result["windows"]:
                self.assertGreaterEqual(item["start"], options["start"])
                self.assertLessEqual(item["end"], options["end"])
                audio, rate = sf.read(root / item["file"])
                self.assertEqual(rate, 16000)
                self.assertEqual(len(audio), item["samples"])
                self.assertLessEqual(len(audio), 480000)
                self.assertGreater(float(np.max(np.abs(audio))), .05)
                self.assertEqual(native.digest(root / item["file"]), item["sha256"])
            self.assertEqual(native.digest(source), source_hash)

    def test_explicit_completion_and_four_observations(self):
        text = "\n".join(f"{i}. **{label}**: Contract fixture, not model output."
                         for i, label in enumerate(("Sound Sources", "Performance", "Pulse and Energy", "Development"), 1))
        prompt = f"<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n<|im_start|>user\n<__media__>{native.PROMPT}<|im_end|>\n<|im_start|>assistant\n"
        log = f"formatted_chat.prompt: {prompt}\nmtmd_completion: reason=eog tokens=198 limit=256"
        self.assertEqual(native.completion(text, log)["formattedPrompt"], prompt)
        for invalid in (
            log.replace("reason=eog", "reason=length"),
            log.replace("reason=eog", "reason=interrupted"),
            log.replace("reason=eog", "reason=antiprompt"),
            log.replace("limit=256", "limit=128"),
            log.replace("tokens=198", "tokens=257"),
            log + "\nmtmd_completion: reason=eog tokens=198 limit=256",
            log.replace(native.PROMPT, "Unexpected prompt"),
            "",
        ):
            with self.subTest(log=invalid), self.assertRaises(native.NativeCaptionError):
                native.completion(text, invalid)
        with self.assertRaises(native.NativeCaptionError):
            native.completion(text.split("4.")[0], log)
        with self.assertRaises(native.NativeCaptionError):
            native.completion(text.replace("Contract fixture, not model output.", ""), log)
        # Completion is native EOG, not a trailing-punctuation heuristic.
        self.assertEqual(native.completion(text.rstrip("."), log)["reason"], "eog")

    def test_windows_stay_inside_excerpt_without_padding(self):
        for rate in (44100, 48000):
            for start, duration in ((20, 10), (20, 30), (0, 60), (1.12345, 600), (20, 30.1), (10, 31)):
                rows = native.windows(start, start + duration, rate)
                self.assertLessEqual(len(rows), 20)
                self.assertEqual(rows[0][0], math.ceil(start * rate))
                self.assertEqual(rows[-1][1], math.floor((start + duration) * rate))
                for first, last in rows:
                    self.assertGreaterEqual(first / rate, start)
                    self.assertLessEqual(last / rate, start + duration)
                    self.assertGreaterEqual(last - first, rate)
                    self.assertLessEqual(last - first, 30 * rate)
            self.assertEqual(native.windows(20, 50.1, rate)[-1],
                             (math.floor(50.1 * rate) - 30 * rate, math.floor(50.1 * rate)))
        with self.assertRaises(native.NativeCaptionError):
            native.windows(0, .9, 44100)
        self.assertEqual(native.windows(.07, 1.07, 44100), [(3087, 47187)])

    def test_preflight_refuses_without_starting_helper(self):
        with mock.patch.object(native, "memory_api", return_value=(object(), object())), \
                mock.patch.object(native, "available_memory", return_value=10 * native.GIB - 1), \
                mock.patch.object(native.subprocess, "Popen") as launch:
            with self.assertRaisesRegex(native.NativeCaptionError, "10 GiB"):
                native.infer_window(Path("unused"), Path("unused"), 0, Path("unused"), 160000)
            launch.assert_not_called()

    def test_reference_frame_and_actual_decode_counts(self):
        for samples, chunks, frames, tokens in ((160000, [50] * 5, 1000, 250), (480000, [50] * 15, 3000, 750),
                                                (32161, [50], 202, 50), (32321, [50, 1], 203, 51)):
            log = "\n".join(f"audio_tokens->n_tokens = {count}\ndecoding audio batch 1/1, n_tokens_batch = {count}" for count in chunks)
            value = native.audio_layout(log, samples)
            self.assertEqual(value["validMelFrames"], frames)
            self.assertEqual(value["encodedAudioTokens"], tokens)
            with self.assertRaises(native.NativeCaptionError):
                native.audio_layout(log.replace("n_tokens_batch", "not_decoded"), samples)
        with self.assertRaises(native.NativeCaptionError):
            native.audio_layout("audio_tokens->n_tokens = 750\ndecoding audio batch 1/1, n_tokens_batch = 750", 160000)

    def test_environment_removes_download_overrides(self):
        with mock.patch.dict(native.os.environ, {"LLAMA_ARG_MODEL_URL": "https://invalid.test/model", "LLAMA_ARG_N_GPU_LAYERS": "99"}):
            environment = native.offline_environment()
        self.assertNotIn("LLAMA_ARG_MODEL_URL", environment)
        self.assertNotIn("LLAMA_ARG_N_GPU_LAYERS", environment)
        self.assertEqual(environment["LLAMA_ARG_OFFLINE"], "1")
        self.assertEqual(environment["HTTPS_PROXY"], "http://127.0.0.1:9")

    def test_archive_rejects_traversal_links_and_duplicate_names(self):
        prefix = f"llama.cpp-{native.SOURCE_COMMIT}/"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, name in enumerate((prefix + "../escape", prefix + "/absolute", prefix + "C:/escape", prefix + "a\\b", "wrong/file")):
                archive = root / f"{index}.zip"
                with zipfile.ZipFile(archive, "w") as writer:
                    entry = zipfile.ZipInfo()
                    entry.filename = name
                    writer.writestr(entry, "contract")
                with self.subTest(name=name), self.assertRaises(native.NativeCaptionError):
                    native.extract_source(archive, root / f"output-{index}")
            archive = root / "link.zip"
            with zipfile.ZipFile(archive, "w") as writer:
                entry = zipfile.ZipInfo(prefix + "link")
                entry.external_attr = 0o120777 << 16
                writer.writestr(entry, "../outside")
            with self.assertRaises(native.NativeCaptionError):
                native.extract_source(archive, root / "linked")
            duplicate = root / "duplicate.zip"
            with zipfile.ZipFile(duplicate, "w") as writer:
                writer.writestr(prefix + "same", "first")
                with self.assertWarns(UserWarning):
                    writer.writestr(prefix + "same", "second")
            with self.assertRaises(native.NativeCaptionError):
                native.extract_source(duplicate, root / "duplicate")
            valid = root / "valid.zip"
            with zipfile.ZipFile(valid, "w") as writer:
                writer.writestr(prefix + "nested/source.cpp", "contract")
            native.extract_source(valid, root / "source")
            self.assertEqual((root / "source/nested/source.cpp").read_text(), "contract")

    def test_native_selection_cannot_silently_run_python_caption_model(self):
        options = {"start": 0, "end": 10, "stems": [], "lyrics": "none", "notes": False,
                   "wordTimestamps": False, "captions": True, "captionModel": "captions-native"}
        with self.assertRaisesRegex(worker.WorkerError, "phased"):
            worker.analyze(Path("unused"), Path("unused"), Path("unused"), options)

    def test_manifest_detects_binary_or_model_tampering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "bin").mkdir()
            content = b"contract only, never executable"
            checksum = hashlib.sha256(content).hexdigest()
            model_files = {name: (len(content), checksum) for name in native.MODEL_FILES}
            paths = [*model_files, *native.NOTICE_FILES, *(f"bin/{name}" for name in native.BINARY_FILES)]
            for name in paths:
                root.joinpath(*name.split("/")).write_bytes(content)
            manifest = {
                "version": 1, "profile": native.PROFILE, "model": native.MODEL, "revision": native.REVISION,
                "build": {"sourceCommit": native.SOURCE_COMMIT, "sourceArchiveSha256": native.SOURCE_SHA256,
                          "patchSha256": checksum, "target": "windows-x64-avx2"},
                "files": {name: {"size": len(content), "sha256": checksum} for name in paths},
            }
            (root / "manifest.json").write_text(json.dumps(manifest))
            with mock.patch.object(native, "platform_check"), mock.patch.object(native, "MODEL_FILES", model_files), \
                    mock.patch.object(native, "PATCH_SHA256", checksum):
                native.read_manifest(root, verify_models=True)
                (root / "bin" / native.BINARY_FILES[0]).write_bytes(b"x" * len(content))
                with self.assertRaisesRegex(native.NativeCaptionError, "checksum"):
                    native.read_manifest(root)
                (root / "bin" / native.BINARY_FILES[0]).write_bytes(content)
                (root / next(iter(model_files))).write_bytes(b"x" * len(content))
                with self.assertRaisesRegex(native.NativeCaptionError, "checksum"):
                    native.read_manifest(root, verify_models=True)


if __name__ == "__main__":
    unittest.main()
