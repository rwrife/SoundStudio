import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInitialState, examples, parseStudioState, steps, studioStateVersion } from '../src/shared/workspace'

test('workspaces have independent drafts and honest initial state', () => {
  const state = createInitialState()
  assert.equal(state.workspace, 'effects')
  assert.equal(state.drafts.effects.step, 'brief')
  assert.equal(state.drafts.effects.duration, '5')
  assert.equal(state.drafts.music.duration, '30')
  state.drafts.effects.prompt = 'Rain on a rooftop'
  assert.equal(state.drafts.music.prompt, '')
  assert.equal(createInitialState().drafts.effects.prompt, '')
})

test('saved drafts round trip with their selected workspace and step', () => {
  const state = createInitialState()
  state.workspace = 'music'
  state.drafts.music.prompt = 'A quiet, atmospheric instrumental'
  state.drafts.music.step = 'review'
  state.drafts.effects.seed = '123'
  assert.deepEqual(parseStudioState(JSON.stringify(state)), state)
})

test('in-progress numeric edits are preserved as drafts, not silently changed', () => {
  const state = createInitialState()
  state.drafts.effects.duration = ''
  state.drafts.music.tempo = '999'
  assert.deepEqual(parseStudioState(JSON.stringify(state)), state)
})

test('rejects malformed, unsupported and incomplete saved state', () => {
  for (const value of ['not json', 'null', '[]', '{}', '{"version":2}', '{"version":3,"workspace":"effects","drafts":{}}', '{"version":1,"workspace":"effects","drafts":null}']) {
    assert.throws(() => parseStudioState(value))
  }
  const state = createInitialState()
  for (const patch of [
    { step: 'complete' }, { prompt: 123 }, { category: 'Unknown' }, { mood: 'Unknown' },
    { loop: 'true' }, { instrumental: null }, { title: 'x'.repeat(121) }, { prompt: 'x'.repeat(4001) },
    { lyrics: 5 }, { lyrics: 'x'.repeat(4001) }, { musicKey: 'H major' }
  ]) {
    assert.throws(() => parseStudioState(JSON.stringify({ ...state, drafts: { ...state.drafts, effects: { ...state.drafts.effects, ...patch } } })))
  }
  assert.throws(() => parseStudioState(JSON.stringify({ ...state, workspace: 'settings' })))
})

test('migrates version 1 drafts by adding empty lyrics and a default key', () => {
  const current = createInitialState()
  current.drafts.music.prompt = 'Warm piano'
  const strip = ({ lyrics: _lyrics, musicKey: _key, ...rest }: typeof current.drafts.music) => rest
  const v1 = { version: 1, workspace: 'music', drafts: { effects: strip(current.drafts.effects), music: strip(current.drafts.music) } }
  const migrated = parseStudioState(JSON.stringify(v1))
  assert.equal(migrated.version, studioStateVersion)
  assert.deepEqual(migrated, { ...current, workspace: 'music' })
  assert.throws(() => parseStudioState(JSON.stringify({ ...v1, version: 2 })), 'version 2 drafts must already include lyrics and key')
})

test('both workspaces have useful sample briefs without output claims', () => {
  assert.equal(steps.length, 4)
  for (const workspace of ['effects', 'music'] as const) {
    assert.equal(examples[workspace].length, 3)
    for (const example of examples[workspace]) {
      assert.ok(example.prompt.length > 40 && example.prompt.length <= 4000)
      const state = createInitialState()
      state.drafts[workspace].category = example.category
      assert.doesNotThrow(() => parseStudioState(JSON.stringify(state)))
    }
  }
})
