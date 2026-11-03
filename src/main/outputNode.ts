import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { outputNodeClass } from '../shared/generation'
import type { OutputNodeState } from '../shared/launcher'

export const outputNodeFolder = 'sound_studio_nodes'
const marker = '# Managed by Sound Studio.'

/**
 * A ComfyUI node that saves audio as 16-bit PCM WAV with Python's standard wave module. ComfyUI's own Save Audio
 * nodes need PyAV and FFmpeg, which are missing or blocked on some PCs (for example Windows on Arm or locked-down devices).
 */
export const outputNodeSource = `${marker} Version 1. Sound Studio replaces this file when it updates the node.
"""Save Audio WAV (Sound Studio): writes 16-bit PCM WAV without PyAV or FFmpeg."""
import os
import wave

import folder_paths
import torch


class SoundStudioSaveWAV:
    CATEGORY = "audio"
    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    DESCRIPTION = "Saves audio as 16-bit PCM WAV using Python's wave module. Installed by Sound Studio."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"audio": ("AUDIO",), "filename_prefix": ("STRING", {"default": "sound-studio/audio"})}}

    def save(self, audio, filename_prefix="sound-studio/audio"):
        folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())
        rate = int(audio["sample_rate"])
        results = []
        for batch, waveform in enumerate(audio["waveform"].detach().cpu()):
            if waveform.dim() == 1:
                waveform = waveform.unsqueeze(0)
            pcm = (waveform.float().clamp(-1.0, 1.0) * 32767.0).round().to(torch.int16).t().contiguous()
            name = f"{filename.replace('%batch_num%', str(batch))}_{counter:05}_.wav"
            with wave.open(os.path.join(folder, name), "wb") as output:
                output.setnchannels(int(waveform.shape[0]))
                output.setsampwidth(2)
                output.setframerate(rate)
                output.writeframes(pcm.numpy().astype("<i2").tobytes())
            results.append({"filename": name, "subfolder": subfolder, "type": "output"})
            counter += 1
        return {"ui": {"audio": results}}


NODE_CLASS_MAPPINGS = {"${outputNodeClass}": SoundStudioSaveWAV}
NODE_DISPLAY_NAME_MAPPINGS = {"${outputNodeClass}": "Save Audio WAV (Sound Studio)"}
`

/** The custom_nodes folder of a recognized install, resolved so the node can never be written outside it. */
async function nodeFolder(mainScript: string) {
  const customNodes = join(await realpath(dirname(mainScript)), 'custom_nodes')
  const target = join(customNodes, outputNodeFolder)
  const rel = relative(customNodes, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unexpected ComfyUI custom_nodes location.')
  return { customNodes, target, file: join(target, '__init__.py') }
}

export async function outputNodeState(mainScript: string): Promise<OutputNodeState> {
  const { file } = await nodeFolder(mainScript)
  if (!existsSync(file)) return 'missing'
  return (await readFile(file, 'utf8')) === outputNodeSource ? 'installed' : 'outdated'
}

/** Installs or updates the node. Returns true when the file changed, so a running ComfyUI must restart to load it. */
export async function installOutputNode(mainScript: string): Promise<boolean> {
  const { customNodes, target, file } = await nodeFolder(mainScript)
  if (existsSync(file)) {
    const current = await readFile(file, 'utf8')
    if (current === outputNodeSource) return false
    if (!current.startsWith(marker)) throw new Error(`${file} was not created by Sound Studio, so it was left untouched. Remove or rename that folder to install the audio output node.`)
  }
  await mkdir(customNodes, { recursive: true })
  await mkdir(target, { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, outputNodeSource, 'utf8')
  await rename(temp, file)
  return true
}
