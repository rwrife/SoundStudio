"""Offline numeric regressions for the experimental, unshipped Omni patch."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys


REFERENCE_COMMIT = "cb39f7dd5ba874ee1859b47283b08cd3a6ab5a0d"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-source", type=Path, required=True)
    parser.add_argument("--native-test", type=Path, required=True)
    parser.add_argument("--dependency-path", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True, help="New directory for generated fixtures and the report")
    args = parser.parse_args()
    source = args.reference_source.resolve(strict=True)
    executable = args.native_test.resolve(strict=True)
    revision = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    dirty = subprocess.check_output(
        ["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True
    ).strip()
    if revision != REFERENCE_COMMIT or dirty:
        parser.error("Reference source must be the exact, unmodified pinned checkout.")
    if sys.byteorder != "little":
        parser.error("The native test dump requires a little-endian host.")
    os.environ.update(USE_TF="0", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    sys.path[:0] = [str(source / "src"), *[str(p.resolve(strict=True)) for p in args.dependency_path]]

    import numpy as np
    import torch
    from transformers import WhisperFeatureExtractor
    from transformers.models.qwen2_5_omni.configuration_qwen2_5_omni import Qwen2_5OmniAudioEncoderConfig
    from transformers.models.qwen2_5_omni.modeling_qwen2_5_omni import Qwen2_5OmniAudioEncoder

    torch.set_num_threads(4)
    torch.manual_seed(42)
    extractor = WhisperFeatureExtractor(feature_size=128)
    config = Qwen2_5OmniAudioEncoderConfig(
        num_mel_bins=128, d_model=16, encoder_layers=2,
        encoder_attention_heads=2, encoder_ffn_dim=32, output_dim=16, n_window=100,
    )
    config._attn_implementation = "eager"
    encoder = Qwen2_5OmniAudioEncoder(config).eval()
    folder = args.output.resolve()
    folder.mkdir(parents=True, exist_ok=False)
    results = []

    def encode(features):
        lens = torch.tensor([features.shape[1]])
        cnn, tokens = encoder._get_feat_extract_output_lengths(lens)
        with torch.inference_mode():
            output = encoder(
                torch.from_numpy(features), feature_lens=lens, aftercnn_lens=cnn
            ).last_hidden_state
        assert len(output) == tokens.item()
        return output

    for count in [321, 31839, 31840, 31999, 32000, 32001, 32160, 32161, 32321,
                  159999, 160000, 160001, 479999, 480000]:
        t = np.arange(count, dtype=np.float64)
        rng = np.random.default_rng(42)
        samples = (
            .2 * np.sin(.173 * t) + .1 * np.sin(.015 * t) + rng.normal(0, .01, count)
        ).astype(np.float32)
        samples[count // 3:count // 2] = 0
        samples[-64:] *= 4
        input_path = folder / f"{count}.f32"
        output_path = folder / f"{count}.bin"
        samples.tofile(input_path)
        subprocess.run(
            [str(executable), "--dump-omni-mel", str(input_path), str(output_path)],
            check=True, timeout=30,
        )
        data = output_path.read_bytes()
        chunks = []
        n_chunks, = struct.unpack_from("<Q", data)
        offset = 8
        for _ in range(n_chunks):
            frames, bins = struct.unpack_from("<qq", data, offset)
            offset += 16
            assert 3 <= frames <= 200 and bins == 128
            chunks.append(np.frombuffer(
                data, dtype="<f4", count=frames * bins, offset=offset
            ).reshape(bins, frames))
            offset += frames * bins * 4
        assert offset == len(data)

        reference = extractor(
            samples, sampling_rate=16000, padding="max_length", return_attention_mask=True
        )
        valid = int(reference.attention_mask.sum())
        features = reference.input_features[0, :, :valid].copy()
        native = np.concatenate(chunks, axis=1)
        delta_array = native - features[:, :native.shape[1]]
        delta = float(np.abs(delta_array).max())
        rms = float(np.sqrt(np.mean(delta_array ** 2)))
        numpy_reference = extractor._np_extract_fbank_features(
            np.pad(samples, (0, 480000 - count))[None, :], "cpu"
        )[0]
        numpy_delta = float(np.abs(native - numpy_reference[:, :native.shape[1]]).max())
        # Float32 FFTs differ most at nearly cancelling low-energy bins.
        # Check the upstream float64 NumPy implementation independently too.
        assert delta < 2e-4 and rms < 2e-6 and numpy_delta < 1e-4, (count, delta, rms, numpy_delta)
        full_encoded = encode(features)
        separate = []
        for start in range(0, valid, 200):
            part = features[:, start:start + 200].copy()
            if part.shape[1] >= 3:
                separate.append(encode(part))
        separate_encoded = torch.cat(separate)
        encoder_delta = float((full_encoded - separate_encoded).abs().max())
        assert encoder_delta < 1e-5, (count, encoder_delta)
        assert sum((part.shape[1] + 1) // 4 for part in chunks) == len(full_encoded)
        result = dict(
            samples=count, valid_frames=valid, native_windows=len(chunks),
            tokens=len(full_encoded), max_mel_error=delta, rms_mel_error=rms,
            max_numpy_mel_error=numpy_delta, max_window_equivalence_error=encoder_delta,
        )
        print(json.dumps(result), flush=True)
        results.append(result)

    report = {
        "reference_commit": REFERENCE_COMMIT,
        "native_test_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "scope": "Actual upstream mel extractor and small random-weight reference encoder; not ML quality",
        "cases": results,
    }
    (folder / "reference-equivalence.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
