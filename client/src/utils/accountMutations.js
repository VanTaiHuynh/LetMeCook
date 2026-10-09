import { supabase } from './supabaseClient';
const assertActor = async (userId, signal) => {
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
  const {data:{session},error} = await supabase.auth.getSession();
  if (error || !userId || session?.user?.id !== userId) throw new Error('Your session changed. Log in again before saving.');
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
};
/** Legacy atomic/RLS-backed writes stay explicit until Java exposes matching mutation contracts. */
export async function favoriteMutation(recipeId,userId,{remove=false,signal}={}) {
  await assertActor(userId,signal);
  let query = supabase.from('recipe_favourites');
  query = remove ? query.delete().eq('user_id',userId).eq('recipe_id',recipeId) : query.insert({recipe_id:recipeId,user_id:userId});
  const {error}=await query.abortSignal(signal); if(error && !(error.code==='23505' && !remove)) throw error;
}
export async function deleteOwnRecipe(recipeId,userId,signal) {
  await assertActor(userId,signal);const {error}=await supabase.from('recipe').delete().eq('id',recipeId).eq('author_id',userId).abortSignal(signal);if(error)throw error;
}
export async function dislikeRecipe(recipeId,userId,signal) {
  await assertActor(userId,signal);const {error}=await supabase.from('recipe_disliked').insert({user_id:userId,recipe_id:recipeId}).abortSignal(signal);if(error && error.code!=='23505')throw error;
}

export async function saveOwnProfile(userId,form,signal) {
  await assertActor(userId,signal);
  const {error}=await supabase.from('users').update({first_name:form.first_name,last_name:form.last_name,
    dietary_pref:form.dietary_pref||[],cooking_skill:form.cooking_skill,about_me:form.about_me,user_allergy:(form.user_allergy||[]).map(item=>item.id)})
    .eq('id',userId).select().abortSignal(signal);if(error)throw error;
}
export async function setOwnProfileImage(userId,imageUrl,signal) {
  await assertActor(userId,signal);const {error}=await supabase.from('users').update({image_url:imageUrl}).eq('id',userId).abortSignal(signal);if(error)throw error;
}
