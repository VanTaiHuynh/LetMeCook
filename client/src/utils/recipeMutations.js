import { supabase } from "./supabaseClient";
import { validateRecipeImage } from "./recipeForm";

export async function saveRecipe(validated, { recipeId = null, dietaryPref = [], cuisine = [], categories = [], signal, actorId } = {}) {
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
  const {data:{session},error:authError}=await supabase.auth.getSession();
  if(authError || !session?.user?.id || (actorId && session.user.id!==actorId)) throw new Error('Your session changed. Log in again before saving.');
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
  let request = supabase.rpc("save_recipe", {
    payload: {
      recipe_id: recipeId,
      ...validated.value,
      ingredients: validated.ingredients,
      dietaryPreferenceIds: dietaryPref.map((item) => item.value),
      cuisineIds: cuisine.map((item) => item.value),
      categoryIds: categories.map((item) => item.value),
    },
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  if (!data) throw new Error("The recipe was not saved. Please try again.");
  return data;
}

export async function uploadRecipeImage(file, userId) {
  const validationError = validateRecipeImage(file);
  if (validationError) throw new Error(validationError);
  if (!userId) throw new Error("Please log in to upload an image.");
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const path = `${userId}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const { error } = await supabase.storage.from("recipe-images").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("recipe-images").getPublicUrl(path).data.publicUrl;
}
