import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildVariationBrief, createInitialState, examples, isGenerationWorkspace, parseStudioState, steps, studioStateVersion, workspaces
} from '../src/shared/workspace'

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

  const { decomposer: _decomposer, ...withoutDecomposer } = state.drafts
  for (const version of [1, studioStateVersion]) {
    const migrated = parseStudioState(JSON.stringify({ version, workspace: 'music', drafts: withoutDecomposer }))
    assert.equal(migrated.version, studioStateVersion)
    assert.equal(migrated.workspace, 'music')
    assert.deepEqual(migrated.drafts.decomposer, createInitialState().drafts.decomposer)
    assert.deepEqual(migrated.drafts.music, state.drafts.music)
  }
})

test('in-progress numeric edits are preserved as drafts, not silently changed', () => {
  const state = createInitialState()
  state.drafts.effects.duration = ''
  state.drafts.music.tempo = '999'
  state.drafts.decomposer.tempo = ''
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
    assert.throws(() => parseStudioState(JSON.stringify({ ...state, drafts: { ...state.drafts, decomposer: { ...state.drafts.decomposer, ...patch } } })))
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

  const v1WithDecomposer = { ...v1, workspace: 'decomposer', drafts: { ...v1.drafts, decomposer: strip(current.drafts.decomposer) } }
  assert.deepEqual(parseStudioState(JSON.stringify(v1WithDecomposer)), { ...current, workspace: 'decomposer' })
  assert.throws(() => parseStudioState(JSON.stringify({ ...v1WithDecomposer, drafts: { ...v1WithDecomposer.drafts, decomposer: null } })),
    'a malformed Decomposer draft is rejected, not replaced')
})

test('only Effects and Music reach generation paths', () => {
  assert.deepEqual(workspaces.map(item => item.id).filter(isGenerationWorkspace), ['effects', 'music'])
  assert.equal(isGenerationWorkspace('decomposer'), false)
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

test('buildVariationBrief maps a Decomposer draft into a Music variation brief within schema limits', () => {
  const state = createInitialState()
  state.drafts.decomposer.title = 'Neon skyline'
  state.drafts.decomposer.prompt = 'Arpeggiated bass and gated drums with airy vocal hook'
  state.drafts.decomposer.category = 'Lyrics & vocals'
  state.drafts.decomposer.mood = 'Uplifting'
  state.drafts.decomposer.tempo = '118'
  state.drafts.decomposer.duration = '45'
  state.drafts.decomposer.loop = true
  state.drafts.decomposer.instrumental = false

  const brief = buildVariationBrief(state.drafts.decomposer)
  assert.equal(brief.title, 'Neon skyline (variation)')
  assert.match(brief.prompt, /Lyrics & vocals \(Uplifting, 118 BPM\)/)
  assert.match(brief.prompt, /Preserve separated stem roles/)
  assert.match(brief.prompt, /Include vocal phrasing and lyric structure/)
  assert.equal(brief.tempo, '118')
  assert.equal(brief.mood, 'Uplifting')
  assert.equal(brief.duration, '45')
  assert.equal(brief.instrumental, false)

  state.drafts.music = { ...state.drafts.music, ...brief, step: 'brief' }
  assert.doesNotThrow(() => parseStudioState(JSON.stringify(state)))
})
