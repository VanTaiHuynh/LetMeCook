import { apiUrl } from './api';
import { supabase } from './supabaseClient';
import { createRecipeReadClient } from './recipeReads';

export const recipeReadClient = createRecipeReadClient({
  baseUrl: apiUrl('/'), getSession: () => supabase.auth.getSession(),
});
