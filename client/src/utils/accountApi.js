import { httpClient } from './httpClient';
import { publicStorageUrl } from './supabaseClient';
/** Versioned, JWT-owned domain reads. No caller-supplied identity in route/query bodies. */
export const accountRequest = (path, options = {}) => httpClient.json(`/account${path}`, { ...options, auth: 'required', service: 'Your account' });
export async function ownProfile(options) {
  const value = await accountRequest('/profile', { ...options, contractVersion: 'account.v1' });
  if (!value.id || !Array.isArray(value.dietaryPreferences) || !Array.isArray(value.allergyNames)) throw new Error('Your profile could not be read. Try again.');
  return { ...value, first_name: value.firstName, last_name: value.lastName, full_name: value.fullName,
    cooking_skill: value.cookingSkill, dietary_pref: value.dietaryPreferences, user_allergy: value.allergyIngredients || [], about_me: value.aboutMe, image_url: publicStorageUrl(value.imageUrl) };
}
export async function accountRecipes(kind, page, options) {
  const value = await accountRequest(`/${kind}?page=${page}&size=24`, options);
  if (!Array.isArray(value.content) || value.content.length > 24 || !Number.isInteger(value.totalElements) || !Number.isInteger(value.totalPages)) throw new Error('Your recipes could not be read. Try again.');
  return value;
}
