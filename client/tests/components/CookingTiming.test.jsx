import { describe, expect, it } from 'vitest';
import { sourceFlowDuration, sourceFlowTiming } from '../../src/features/cooking/cookingTiming';

const source = (text, seconds) => { const timing = sourceFlowTiming(text); expect(timing.kind).toBe('source'); expect(timing.seconds).toBe(seconds); expect(timing.reason).toBeTruthy(); expect(timing.segments.length).toBeGreaterThan(0); return timing; };
const unknown = (text, reasonCode) => { const timing = sourceFlowTiming(text); expect(timing.kind).toBe('unknown'); expect(timing.seconds).toBeNull(); expect(timing.reasonCode).toBe(reasonCode); expect(timing.reason).toBeTruthy(); return timing; };

describe('recipe-derived cooking waits', () => {
  it('derives the real red onion and potato salad instructions without treating a hot barbecue as a parallel task', () => {
    source('Boil the potatoes in a large pan of salted water for about 10 mins until just cooked. In a large bowl, stir the oil and vinegar together with some salt and pepper. While the barbecue is still hot, grill the onion slices for 5 mins on each side until lightly charred. Toss the hot onions, separating them into rings, in the dressing.', 1200);
    source('Toss the potatoes in a small drizzle of oil and grill on the barbecue, cut side down, for about 5 mins until browned, then toss with the onions. Mix in the parsley and serve.', 300);
  });
  it.each([
    ['Bake for 20-30 minutes.', 1800], ['Rest for 5 minutes to 10 minutes.', 600], ['Cook between 5 and 8 mins.', 480],
    ['Leave to set for 45 mins-1 hr.', 3600], ['Cook for 2 hrs 30 mins – 2 hrs 45 mins or until soft.', 9900],
    ['Simmer for 1 hour 10 minutes.', 4200], ['Rest for 1 1/2 hours.', 5400], ['Rest for 1½ hours.', 5400],
    ['Rest for half an hour.', 1800], ['Rest for a quarter of an hour.', 900], ['Cook for an hour and a half.', 5400],
    ['Cook for twenty-five minutes.', 1500], ['Cook for a couple of minutes.', 120], ['Stir for ⅓ minute.', 20],
  ])('uses explicit numeric, word, fraction and compound-unit times: %s', (text, seconds) => { source(text, seconds); });
  it('uses source range upper bounds and exposes why the selected wait differs from its lower bound', () => {
    const timing = source('Fry for 3-4 mins on each side.', 480); expect(timing.segments[0]).toMatchObject({ baseSeconds: 240, multiplier: 2, repetition: 'sides', rule: 'range-upper' }); expect(timing.reason).toContain('upper limit');
  });
  it('does not multiply a result described as golden on both sides, and respects an explicit side count', () => {
    source('Cook for 5 minutes until golden on both sides.', 300);
    source('Grill for 1 minute on each of the four sides.', 240);
  });
  it('uses a complete explicit batch or repeat count, while unspecified batch counts remain unknown', () => {
    source('Fry in three batches for 5 minutes per batch.', 900);
    source('Fry for 5 minutes. Repeat twice more.', 900);
    source('Cook for 2 minutes. Repeat three times in total.', 360);
    unknown('Fry in batches for 5 minutes per batch.', 'unbounded_repetition');
    unknown('Fry for 5 minutes. Repeat with the remaining batter.', 'unbounded_repetition');
  });
  it('adds source sequential durations and excludes stirring/check frequencies', () => {
    const timing = source('Heat the oil in a frying pan and cook the onion until very soft, for around 10-12 mins. Add the cinnamon, cumin and paprika to the onions and cook for a further 2-3 mins. Next add the hot sauce, vinegar and bbq sauce and mix well before adding in the tomato, the drained jackfruit and 200ml water. Leave to simmer gently, covered, for 30 mins stirring every 5-10 mins to help break down the jackfruit, then take the lid off and cook a further 10 minutes.', 3300);
    expect(timing.ignored.some(segment => segment.reasonCode === 'frequency')).toBe(true);
    source('Melt in the microwave, stirring every 30 secs. Leave the melted chocolate to cool for 5 mins.', 300);
  });
  it('excludes elapsed checkpoints without discarding a real wait before a later action', () => {
    source('Let it boil vigorously for 5 mins before reducing to a low heat and simmer for 45 mins. Check the mung beans after 30 mins.', 3000);
    source('Roast in the oven for 1 hr until tender. Check the beetroot after 50 mins as they will cook more quickly than the potatoes.', 3600);
    source('Cook the lamb for 15-20 mins. Rest for 5-10 mins before taking out the skewers and serving.', 1800);
    source('Roast the onions for 20 mins. After 20 mins, stir this into the onions. Roast for 10 mins more until sticky.', 1800);
  });
  it('keeps active freezer and keeping instructions timed while excluding shelf-life information', () => {
    source('Freeze for 2 hrs.', 7200); source('Freeze again for 1 hr. Will keep for 1 month frozen.', 3600);
    source('Keep stirring for 5-8 mins.', 480); source('Keep the pan on the stove with a lid on for another 2 mins.', 120);
    source('Turn the heat up to reach a rolling boil for 2 mins, then turn off the heat, but keep the pan on the stove with a lid on for another 2 mins. Drain the boba under running water for about 20 seconds.', 260);
    source('Chill for 1 hr. Keep in the fridge for up to 2 days.', 3600);
  });
  it('uses parallel task timelines, and adds a later wait after both tasks join', () => {
    source('Boil the rice for 10 minutes. Meanwhile, fry the onions for 5 minutes.', 600);
    source('While the rice simmers for 20 minutes, roast the vegetables for 15 minutes.', 1200);
    source('Boil for 10 mins, then rest for 5 mins. While resting, cook the sauce for 20 mins.', 1800);
    source('Boil the rice for 10 mins. Meanwhile, fry the onions for 5 mins. Once both are ready, rest for 2 mins.', 720);
    source('Simmer the pasta for 3 mins. Meanwhile, heat the oil. Fry the mushrooms for 1 min. Add mixed mushrooms and fry for 2-3 mins more.', 240);
  });
  it('does not make untimed meanwhile preparation overlap a later continuation of cooking', () => {
    source('Roast for 20 mins. Meanwhile, season the lamb with pepper. Add the lamb to the tin and cook for 25 mins more. Remove the lamb, cover and leave to rest for 5 mins.', 3000);
  });
  it('does not add repeated totals or choose a size or alternative cooking method for the user', () => {
    source('Fry for 1 min, then turn. Fry for another 1 min then turn once more so each side fries for 2 mins in total.', 240);
    unknown('Simmer the small pud for 1½ hrs, medium for 2½ hrs and large for 3½ hrs.', 'alternative_durations');
    unknown('Boil for 10 minutes or bake for 20 minutes.', 'alternative_durations');
    source('Bake for 20 mins or until golden. Rest for 5 mins.', 1500);
  });
  it('distinguishes untimed prep from cooking with an unstated duration and preserves ambiguous formatting', () => {
    unknown('Mix the dressing and serve.', 'no_duration'); unknown('Bake until golden.', 'no_explicit_duration');
    unknown('Simmer overnight.', 'no_explicit_duration'); unknown('Cook for 11⁄2 mins.', 'ambiguous_duration');
    unknown('Cook for at least 10 minutes.', 'minimum_duration'); unknown('Marinate for 2 days.', 'duration_limit');
  });
  it('ignores temperature/dimensions, diagnostic bread tests and readiness references', () => {
    unknown('Heat the oil to 180C, or when a cube of bread browns in 30 seconds. Deep-fry the potatoes until golden.', 'no_explicit_duration');
    unknown('About 10 mins before the parsnips are ready, put sugar in a pan.', 'no_explicit_duration');
    unknown('Roll to approximately 1m x 50cm. Heat oven to 180C.', 'no_duration');
  });
  it('keeps the old adapter compatible and strips recipe HTML without running it', () => {
    expect(sourceFlowDuration('Mix and serve.')).toBeNull(); expect(sourceFlowDuration('<p>Rest for <strong>5 mins</strong>.</p>')).toMatchObject({ kind: 'source', seconds: 300 });
  });
});
