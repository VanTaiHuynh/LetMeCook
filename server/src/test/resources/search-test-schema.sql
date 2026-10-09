CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY, first_name VARCHAR DEFAULT '', last_name VARCHAR DEFAULT '', role VARCHAR DEFAULT 'user',
 email VARCHAR, about_me TEXT, image_url VARCHAR, cooking_skill VARCHAR, dietary_pref VARCHAR ARRAY
);
CREATE TABLE IF NOT EXISTS recipe (
 id UUID PRIMARY KEY, title VARCHAR, description TEXT, servings REAL DEFAULT 0, image_url VARCHAR,
 source_url TEXT, source_license TEXT, source_author TEXT, image_source_url TEXT, image_author TEXT,
 image_license TEXT, image_kind TEXT, is_public BOOLEAN, created_at TIMESTAMP, directions TEXT,
 view_count INTEGER DEFAULT 0, time INTEGER DEFAULT 0, author_id UUID
);
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS rating_average DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS demo_permission_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS demo_permission_note TEXT;
CREATE TABLE IF NOT EXISTS ingredients (id UUID PRIMARY KEY, name VARCHAR);
CREATE TABLE IF NOT EXISTS recipe_ingredients (id UUID PRIMARY KEY, recipe_id UUID, ingredient_id UUID, quantity VARCHAR, unit VARCHAR);
CREATE TABLE IF NOT EXISTS categories (id UUID PRIMARY KEY, name VARCHAR);
CREATE TABLE IF NOT EXISTS cuisines (id UUID PRIMARY KEY, name VARCHAR);
CREATE TABLE IF NOT EXISTS dietary_pref (id UUID PRIMARY KEY, name VARCHAR);
CREATE TABLE IF NOT EXISTS recipe_categories (recipe_id UUID, category_id UUID);
CREATE TABLE IF NOT EXISTS recipe_cuisines (recipe_id UUID, cuisine_id UUID);
CREATE TABLE IF NOT EXISTS recipe_dietary_pref (recipe_id UUID, preference_id UUID);
CREATE TABLE IF NOT EXISTS recipe_favourites (id UUID PRIMARY KEY, user_id UUID, recipe_id UUID, created_at TIMESTAMP WITH TIME ZONE);
CREATE TABLE IF NOT EXISTS recipe_browsing_history (id UUID PRIMARY KEY, user_id UUID, recipe_id UUID, viewed_at TIMESTAMP WITH TIME ZONE);
CREATE TABLE IF NOT EXISTS recipe_disliked (id UUID PRIMARY KEY, user_id UUID, recipe_id UUID);
CREATE TABLE IF NOT EXISTS user_allergy (user_id UUID, ingredient_id UUID, PRIMARY KEY(user_id,ingredient_id));
