import { recipeText } from '../../utils/recipeContent.js';

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, couple: 2, half: .5, quarter: .25 };
const FRACTIONS = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|a couple(?: of)?|half(?: an?| of an?)?|(?:a )?quarter(?: of an?)?|a|an)';
const VALUE = `(?:\\d+\\s+\\d+\\s*[/⁄]\\s*\\d+|\\d+\\s*[/⁄]\\s*\\d+|\\d+(?:\\.\\d+)?\\s*[½¼¾⅓⅔⅛⅜⅝⅞]?|[½¼¾⅓⅔⅛⅜⅝⅞]|${WORD})`;
const UNIT = '(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?)';
const ATOM = `${VALUE}\\s*${UNIT}\\b`;
const EXPRESSION = `${ATOM}(?:\\s*(?:,?\\s*and\\s+|,\\s*)?${ATOM}){0,2}`;
const BOUNDARY = '(?<![\\w./⁄])';
const ACTIONS = /\b(cook(?:s|ing|ed)?|simmer(?:s|ing|ed)?|boil(?:s|ing|ed)?|bak(?:e|es|ing|ed)|fry(?:ing)?|fr(?:ies|ied)|roast(?:s|ing|ed)?|grill(?:s|ing|ed)?|steam(?:s|ing|ed)?|rest(?:s|ing|ed)?|cool(?:s|ing|ed)?|chill(?:s|ing|ed)?|marinat(?:e|es|ing|ed)|soak(?:s|ing|ed)?|prov(?:e|es|ing|ed)|proof(?:s|ing|ed)?|knead(?:s|ing|ed)?|whisk(?:s|ing|ed)?|beat(?:s|ing)?|stir(?:s|ring|red)?|heat(?:s|ing|ed)?|stand(?:s|ing)?|leav(?:e|es|ing|ed))\b/gi;
const clauseStart = (text, at) => { const matches = [...text.slice(0, at).matchAll(/[.!?;]\s+/g)]; const last = matches.at(-1); return last ? last.index + last[0].length : 0; };
const clauseEnd = (text, at) => { const match = /[.!?;](?:\s|$)/.exec(text.slice(at)); return match ? at + match.index : text.length; };
const actionBase = word => word.toLowerCase().replace(/^(?:fries|fried|frying)$/, 'fry').replace(/^bak(?:e|es|ing|ed)$/, 'bake').replace(/^marinat(?:e|es|ing|ed)$/, 'marinate').replace(/^prov(?:e|es|ing|ed)$/, 'prove').replace(/^leav(?:e|es|ing|ed)$/, 'leave').replace(/^stir(?:s|ring|red)$/, 'stir').replace(/(?:ing|ed|s)$/, '');
const lastAction = text => [...text.matchAll(ACTIONS)].at(-1)?.[1] || '';

function numberValue(raw) {
  let value = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  const mixed = /^(\d+)\s+(\d+)\s*[/⁄]\s*(\d+)$/.exec(value);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\s*[/⁄]\s*(\d+)$/.exec(value);
  // A source typo such as “11⁄2” can mean either 11/2 or 1½. Do not invent a correction.
  if (fraction) return fraction[1].length > 1 ? NaN : Number(fraction[1]) / Number(fraction[2]);
  const unicode = /^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(value);
  if (unicode) return Number(unicode[1] || 0) + FRACTIONS[unicode[2]];
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  value = value.replace(/^a couple(?: of)?$/, 'couple').replace(/^half(?: an?| of an?)?$/, 'half').replace(/^(?:a )?quarter(?: of an?)?$/, 'quarter');
  return value.split(/[- ]/).reduce((sum, word) => sum + (WORDS[word] ?? NaN), 0);
}
const unitSeconds = unit => /^d/i.test(unit) ? 86400 : /^h/i.test(unit) ? 3600 : /^m/i.test(unit) ? 60 : 1;
function expressionSeconds(expression) {
  const atoms = [...expression.matchAll(new RegExp(`(${VALUE})\\s*(${UNIT})\\b`, 'gi'))];
  return atoms.length ? atoms.reduce((sum, match) => sum + numberValue(match[1]) * unitSeconds(match[2]), 0) : NaN;
}
function timeLabel(seconds) {
  if (seconds % 3600 === 0 && seconds > 0) return `${seconds / 3600} ${seconds === 3600 ? 'hour' : 'hours'}`;
  if (seconds % 60 === 0 && seconds > 0) return `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}
const unknown = (reasonCode, reason, segments = [], ignored = []) => ({ kind: 'unknown', seconds: null, label: 'No automatic wait', reasonCode, reason, segments, ignored });

function scanDurations(text) {
  const found = [];
  const add = (match, seconds, rule) => {
    const start = match.index, end = start + match[0].length;
    if (!found.some(segment => start < segment.end && end > segment.start)) found.push({ text: match[0], start, end, baseSeconds: seconds, seconds, rule });
  };
  for (const match of text.matchAll(new RegExp(`${BOUNDARY}(${EXPRESSION})\\s*(?:[-–—]|to)\\s*(${EXPRESSION})`, 'gi'))) add(match, Math.max(expressionSeconds(match[1]), expressionSeconds(match[2])), 'range-upper');
  for (const match of text.matchAll(new RegExp(`${BOUNDARY}between\\s+(${VALUE})\\s*(${UNIT})?\\s+and\\s+(${VALUE})\\s*(${UNIT})\\b`, 'gi'))) add(match, Math.max(numberValue(match[1]) * unitSeconds(match[2] || match[4]), numberValue(match[3]) * unitSeconds(match[4])), 'range-upper');
  for (const match of text.matchAll(new RegExp(`${BOUNDARY}(${VALUE})\\s*(?:[-–—]|to)\\s*(${VALUE})\\s*(${UNIT})\\b`, 'gi'))) {
    if (/^(?:twenty|thirty|forty|fifty|sixty)-(?:one|two|three|four|five|six|seven|eight|nine)\s/i.test(match[0])) continue;
    add(match, Math.max(numberValue(match[1]), numberValue(match[2])) * unitSeconds(match[3]), 'range-upper');
  }
  for (const match of text.matchAll(new RegExp(`${BOUNDARY}${EXPRESSION}`, 'gi'))) {
    let seconds = expressionSeconds(match[0]);
    const half = /^\s+and\s+(?:a\s+)?(half|quarter)(?=\s*(?:[.,;]|$|until\b|before\b|then\b|to\b))/i.exec(text.slice(match.index + match[0].length));
    if (half) { const units = [...match[0].matchAll(new RegExp(UNIT, 'gi'))]; seconds += unitSeconds(units.at(-1)[0]) * WORDS[half[1].toLowerCase()]; const extended = Object.assign([match[0] + half[0]], { index: match.index }); add(extended, seconds, 'compound'); }
    else add(match, seconds, [...match[0].matchAll(new RegExp(UNIT, 'gi'))].length > 1 ? 'compound' : 'explicit');
  }
  return found.sort((a, b) => a.start - b.start);
}

function repetition(text, segment) {
  const prefix = text.slice(clauseStart(text, segment.start), segment.start), suffix = text.slice(segment.end, clauseEnd(text, segment.end));
  const side = /^\s*(?:on\s+)?(?:each|per|a)\s+side\b|^\s*(?:on\s+)?each\s+of\s+(?:the\s+)?(?:\d+|two|three|four|five|six)\s+sides\b/i.test(suffix) || /\b(?:each|per)\s+side\s+(?:(?:cook(?:s)?|fry|fries|grill(?:s)?)\s+)?(?:for\s+)?(?:about\s+)?$/i.test(prefix);
  if (side) {
    const count = new RegExp(`(?:each\\s+of\\s+(?:the\\s+)?|all\\s+)?(${VALUE})\\s+sides\\b`, 'i').exec(prefix + ' ' + suffix);
    return { multiplier: count ? numberValue(count[1]) : 2, repetition: 'sides' };
  }
  const perBatch = /^\s*(?:for\s+)?(?:per|each|a)\s+batch\b|^\s+each\b/i.test(suffix) || /\b(?:each|per)\s+batch\s+(?:for\s+)?$/i.test(prefix);
  const batchCount = new RegExp(`(${VALUE})\\s+batches\\b`, 'i').exec(prefix + ' ' + suffix) || new RegExp(`(${VALUE})\\s+batches\\b`, 'i').exec(text);
  if (perBatch && batchCount) return { multiplier: numberValue(batchCount[1]), repetition: 'batches' };
  if (perBatch) return { ambiguous: true };
  return { multiplier: 1 };
}

function parallelCue(text, previous, current) {
  const between = text.slice(previous.end, current.start);
  const whileMatch = /\bwhile\b([^,.;]*)/i.exec(between);
  if (whileMatch) {
    const action = lastAction(whileMatch[1]);
    if (action) return { kind: 'parallel', action: actionBase(action) };
  }
  const meanwhile = /\b(?:meanwhile|at the same time|simultaneously)\b([^]*?)(?=$)/i.exec(between);
  if (meanwhile) {
    const firstClause = meanwhile[1].split(/[.;]/)[0];
    if ([...firstClause.matchAll(ACTIONS)].length) return { kind: 'parallel' };
  }
  // “While the rice simmers for 20 minutes, roast ... for 15 minutes.”
  const previousClause = text.slice(clauseStart(text, previous.start), previous.start);
  if (/\bwhile\b/i.test(previousClause) && lastAction(previousClause) && !/[.;]/.test(between)) return { kind: 'parallel', action: previous.action };
  return { kind: 'sequential' };
}

/** Derive waits only from times supplied by the recipe; unknown is never an AI estimate. */
export function sourceFlowTiming(step = '') {
  const text = recipeText(step), raw = scanDurations(text), segments = [], ignored = [];
  for (const segment of raw) {
    const prefix = text.slice(clauseStart(text, segment.start), segment.start), immediate = text.slice(Math.max(0, segment.start - 35), segment.start), suffix = text.slice(segment.end, clauseEnd(text, segment.end));
    const cookingActions = [...prefix.matchAll(ACTIONS)], storageActions = [...prefix.matchAll(/\b(?:store|keep|kept|freeze|frozen|keeps|stored)\b/gi)];
    const storageWindow = storageActions.length ? prefix.slice(storageActions.at(-1).index) : '';
    const shelfLife = /\b(?:will|can)\s+(?:be\s+)?(?:kept|frozen|stored|keep|freeze|store)\b/i.test(prefix) || /\b(?:up to|maximum|at most)\b/i.test(storageWindow);
    const storage = storageActions.length && (!cookingActions.length || storageActions.at(-1).index > cookingActions.at(-1).index)
      && (/\b(?:store|stored)\b/i.test(prefix) || shelfLife) && !/\buntil\s+(?:firm|set|cold|hard|frozen)\b/i.test(suffix);
    let ignoredReason = /\b(?:every|each)\s*$/i.test(immediate) ? 'frequency' : /\b(?:within|before|ahead(?: of time)?|ago)\s*$/i.test(immediate) || (/^\s+before\b/i.test(suffix) && !lastAction(prefix)) ? 'reference' : storage ? 'storage' : /\b(?:cube|piece)\s+of\s+bread\b/i.test(prefix) ? 'diagnostic' : null;
    const milestone = /\b(?:check|stir|turn|rotate|shake|top up)\b[^]*\bafter\s*(?:about\s*)?$/i.test(prefix) || (/^\s*(?:after|about)\b/i.test(prefix) && /^\s*,?\s*(?:check|stir|turn|rotate|shake)\b/i.test(suffix));
    if (milestone && segments.length) ignoredReason = 'elapsed-reference';
    if (/\bafter\s*$/i.test(immediate) && segments.some(prior => prior.baseSeconds === segment.baseSeconds)) ignoredReason = 'elapsed-reference';
    if (ignoredReason) { ignored.push({ ...segment, reasonCode: ignoredReason }); continue; }
    if (/\bat least\s*$/i.test(immediate)) return unknown('minimum_duration', 'The recipe gives a minimum time, without a complete wait.', raw, ignored);
    if (!Number.isFinite(segment.seconds) || !Number.isInteger(segment.seconds) || segment.seconds < 0) return unknown('ambiguous_duration', 'A recipe time could not be read unambiguously.', raw, ignored);
    const repeat = repetition(text, segment);
    if (repeat.ambiguous || !Number.isInteger(repeat.multiplier) || repeat.multiplier < 1) return unknown('unbounded_repetition', 'The recipe does not state how many batches or repetitions to time.', raw, ignored);
    segment.multiplier = repeat.multiplier; segment.repetition = repeat.repetition; segment.seconds *= repeat.multiplier;
    segment.action = actionBase(lastAction(prefix));
    if (/^\s+in total\b/i.test(suffix) || /\btotal(?: of)?\s*$/i.test(prefix)) {
      const covered = segments.filter(prior => prior.action === segment.action);
      if (covered.length && covered.reduce((sum, prior) => sum + prior.seconds, 0) <= segment.seconds) {
        for (const prior of covered) { ignored.push({ ...prior, reasonCode: 'covered-by-total' }); segments.splice(segments.indexOf(prior), 1); }
        segment.rule = 'explicit-total';
      }
    }
    segments.push(segment);
  }
  if (!segments.length) {
    const timedAction = /\b(?:cook|simmer|boil|bake|fry|roast|grill|steam|rest|cool|chill|marinate|soak|prove|proof|leave|stand)\b/i.test(text);
    return unknown(timedAction || raw.length ? 'no_explicit_duration' : 'no_duration', timedAction || raw.length ? 'The recipe gives no complete cooking wait. Add a time if you need one.' : 'No timed wait is stated in this instruction.', [], ignored);
  }
  const span = text.slice(segments[0].start, segments.at(-1).end);
  const alternative = new RegExp(`\\bor\\s+(?:for\\s+)?(?:${ATOM}|(?:cook|bake|fry|simmer|roast|grill)\\b|if\\b)|\\b(?:alternatively|depending)\\b`, 'i');
  if (segments.length > 1 && alternative.test(span)) return unknown('alternative_durations', 'The recipe gives alternative times. Choose the one that fits your cooking.', segments, ignored);
  const sizes = segments.map(segment => /\b(small|medium|large)\s+(?:(?:pud(?:ding)?s?|cakes?|loaves?)\s+)?(?:for\s+)?$/i.exec(text.slice(clauseStart(text, segment.start), segment.start))?.[1]?.toLowerCase()).filter(Boolean);
  if (new Set(sizes).size > 1) return unknown('alternative_durations', 'Cooking time depends on the size described in the recipe.', segments, ignored);
  const batches = /\bbatches\b/i.exec(text);
  if (batches && !new RegExp(`(${VALUE})\\s+batches\\b`, 'i').test(text)) {
    const batchClause = text.slice(clauseStart(text, batches.index), clauseEnd(text, batches.index));
    const batchAction = actionBase(lastAction(batchClause));
    if (segments.some(segment => segment.action === batchAction && /^(?:cook|fry|bake|grill|roast)$/.test(batchAction))) return unknown('unbounded_repetition', 'The recipe cooks in batches without stating a complete batch count.', segments, ignored);
  }
  const repeats = [...text.matchAll(/\brepeat(?:ing|ed)?\b/gi)];
  let totalMultiplier = 1;
  for (const repeat of repeats) {
    if (repeat.index < segments[0].start) continue;
    const clause = text.slice(repeat.index, clauseEnd(text, repeat.index));
    const extra = new RegExp(`repeat(?:[^.]*?)\\b(${VALUE}|twice|once)\\s+(?:times?\\s+)?more\\b`, 'i').exec(clause);
    const total = new RegExp(`repeat(?:[^.]*?)\\b(${VALUE})\\s+times?\\s+in total\\b`, 'i').exec(clause);
    if (extra) totalMultiplier *= 1 + (extra[1].toLowerCase() === 'twice' ? 2 : extra[1].toLowerCase() === 'once' ? 1 : numberValue(extra[1]));
    else if (total) totalMultiplier *= numberValue(total[1]);
    else return unknown('unbounded_repetition', 'The repeated cooking process has no complete count.', segments, ignored);
  }
  const groups = [{ branches: [[segments[0]]] }];
  for (let index = 1; index < segments.length; index++) {
    const segment = segments[index], previous = segments[index - 1], cue = parallelCue(text, previous, segment), between = text.slice(previous.end, segment.start);
    let group = groups.at(-1);
    if (cue.kind === 'parallel') {
      if (cue.action && group.branches.length === 1) {
        const target = group.branches[0].findIndex(item => item.action === cue.action);
        if (target > 0) { const trailing = group.branches[0].splice(target); groups.push({ branches: [trailing] }); group = groups.at(-1); }
      }
      group.branches.push([segment]);
    } else if (group.branches.length > 1 && /\b(?:both|all|together)\b/i.test(between) && /\b(?:once|when|after|then)\b/i.test(between)) groups.push({ branches: [[segment]] });
    else group.branches.at(-1).push(segment);
  }
  const seconds = groups.reduce((sum, group) => sum + Math.max(...group.branches.map(branch => branch.reduce((total, segment) => total + segment.seconds, 0))), 0) * totalMultiplier;
  if (!Number.isInteger(seconds) || seconds > 86400) return unknown('duration_limit', 'The recipe’s complete wait is longer than the supported 24-hour timer.', segments, ignored);
  const rules = new Set(segments.map(segment => segment.rule));
  const parallel = groups.some(group => group.branches.length > 1), sides = segments.some(segment => segment.repetition === 'sides'), batchesTimed = segments.some(segment => segment.repetition === 'batches');
  const reasons = [parallel ? 'Overlapping tasks use the longer wait' : segments.length > 1 ? 'Sequential recipe times are added' : 'Uses the time stated in the recipe'];
  if (rules.has('range-upper')) reasons.push('ranges use their upper limit');
  if (sides) reasons.push('per-side times include both sides');
  if (batchesTimed || totalMultiplier > 1) reasons.push('includes the stated batch or repeat count');
  return { kind: 'source', seconds, label: timeLabel(seconds), reasonCode: parallel ? 'parallel_durations' : segments.length > 1 ? 'sequential_durations' : 'explicit_duration', reason: `${reasons.join('; ')}.`, segments, ignored, groups: groups.map(group => group.branches.map(branch => branch.map(segment => segments.indexOf(segment)))), repeatMultiplier: totalMultiplier };
}

export function sourceFlowDuration(step = '') { const result = sourceFlowTiming(step); return result.kind === 'source' ? result : null; }
