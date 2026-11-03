import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInitialState, examples, parseStudioState, steps, workspaces } from '../src/shared/workspace'

test('workspaces have independent drafts and honest initial state', () => {
  const state = createInitialState()
  assert.equal(state.workspace, 'effects')
  assert.equal(state.drafts.effects.step, 'brief')
  assert.equal(state.drafts.effects.duration, '5')
  assert.equal(state.drafts.music.duration, '30')
  assert.equal(state.drafts.decomposer.duration, '30')
  assert.equal(state.drafts.decomposer.category, 'Full breakdown')
  assert.equal(state.drafts.decomposer.loop, true)
  assert.equal(state.drafts.decomposer.instrumental, false)
  state.drafts.effects.prompt = 'Rain on a rooftop'
  state.drafts.decomposer.prompt = 'Separate drums and vocals'
  assert.equal(state.drafts.music.prompt, '')
  assert.equal(createInitialState().drafts.effects.prompt, '')
  assert.equal(createInitialState().drafts.decomposer.prompt, '')
})

test('saved drafts round trip with their selected workspace and step, including legacy v1 migration', () => {
  const state = createInitialState()
  state.workspace = 'decomposer'
  state.drafts.music.prompt = 'A quiet, atmospheric instrumental'
  state.drafts.music.step = 'review'
  state.drafts.decomposer.prompt = 'Isolate lead vocal and transcribe chorus lyrics'
  state.drafts.decomposer.step = 'generate'
  state.drafts.effects.seed = '123'
  assert.deepEqual(parseStudioState(JSON.stringify(state)), state)

  const legacy = {
    version: 1,
    workspace: 'music',
    drafts: {
      effects: state.drafts.effects,
      music: state.drafts.music
    }
  }
  const migrated = parseStudioState(JSON.stringify(legacy))
  assert.equal(migrated.workspace, 'music')
  assert.deepEqual(migrated.drafts.decomposer, createInitialState().drafts.decomposer)
})

test('in-progress numeric edits are preserved as drafts, not silently changed', () => {
  const state = createInitialState()
  state.drafts.effects.duration = ''
  state.drafts.music.tempo = '999'
  state.drafts.decomposer.tempo = ''
  assert.deepEqual(parseStudioState(JSON.stringify(state)), state)
})

test('rejects malformed, unsupported and incomplete saved state', () => {
  for (const value of ['not json', 'null', '[]', '{}', '{"version":2}', '{"version":1,"workspace":"effects","drafts":null}']) {
    assert.throws(() => parseStudioState(value))
  }
  const state = createInitialState()
  for (const patch of [
    { step: 'complete' }, { prompt: 123 }, { category: 'Unknown' }, { mood: 'Unknown' },
    { loop: 'true' }, { instrumental: null }, { title: 'x'.repeat(121) }, { prompt: 'x'.repeat(4001) }
  ]) {
    assert.throws(() => parseStudioState(JSON.stringify({ ...state, drafts: { ...state.drafts, effects: { ...state.drafts.effects, ...patch } } })))
    assert.throws(() => parseStudioState(JSON.stringify({ ...state, drafts: { ...state.drafts, decomposer: { ...state.drafts.decomposer, ...patch } } })))
  }
  assert.throws(() => parseStudioState(JSON.stringify({ ...state, workspace: 'settings' })))
})

test('all workspaces have useful sample briefs without output claims', () => {
  assert.equal(steps.length, 4)
  assert.equal(workspaces.length, 3)
  for (const { id: workspace } of workspaces) {
    assert.equal(examples[workspace].length, 3)
    for (const example of examples[workspace]) {
      assert.ok(example.prompt.length > 40 && example.prompt.length <= 4000)
      const state = createInitialState()
      state.drafts[workspace].category = example.category
      assert.doesNotThrow(() => parseStudioState(JSON.stringify(state)))
    }
  }
})
