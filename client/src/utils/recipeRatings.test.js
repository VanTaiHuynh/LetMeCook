import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRecipeRatings, ratingStars } from './recipeRatings.js';

test('recorded review categories retain their independent averages and overall count', () => {
  const rows = [{ category: 'cost', value: 1 }, { category: 'time', value: 2 }, { category: 'difficulty', value: 3 }, { category: 'overall', value: 5 }];
  assert.deepEqual(aggregateRecipeRatings(rows), { cost: 1, time: 2, difficulty: 3, overall: 5, overallCount: 1 });
  assert.equal(ratingStars(1), '★☆☆☆☆');
  assert.equal(ratingStars(2), '★★☆☆☆');
  assert.equal(ratingStars(3), '★★★☆☆');
  assert.equal(ratingStars(5), '★★★★★');
});

test('absent and invalid ratings never produce a score or invent five stars', () => {
  const result = aggregateRecipeRatings([{ category: 'cost', value: null }, { category: 'cost', value: '' }, { category: 'cost', value: 0 }, { category: 'cost', value: 6 }, { category: 'overall', value: 'invalid' }]);
  assert.deepEqual(result, { cost: null, time: null, difficulty: null, overall: null, overallCount: 0 });
  assert.equal(ratingStars(null), '');
  assert.equal(ratingStars(6), '');
  assert.equal(aggregateRecipeRatings([{ category: 'cost', value: 1 }, { category: 'cost', value: 4 }]).cost, 2.5);
});
