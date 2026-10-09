import { FiPlus, FiMinus } from "react-icons/fi";
import useRecipeDraft, { RECIPE_UNITS as UNITS } from "../features/editor/useRecipeDraft";
import Alert from "../components/ui/Alert";
import { useRecipeTags, useIngredientSuggestions } from "../features/editor/useRecipeEditorResources";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import RecipeWriteGate from "../components/RecipeWriteGate";
import useRecipeWriteGate from "../utils/useRecipeWriteGate";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import RecipeImage from '../components/RecipeImage';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Select from 'react-select';
import './RecipeForm.css';
import { validateRecipeForm } from '../utils/recipeForm';
import { saveRecipe, uploadRecipeImage } from '../utils/recipeMutations';




export default function CreateRecipe() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page product-recipe-form-page create-recipe-container"><h1 className="product-page-title">Create recipe</h1><p role="status">Loading your account…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: '/create-recipe' }} />;
  return <CreateRecipeForm key={user.id} user={user} />;
}

function CreateRecipeForm({ user }) {
  const writeGate = useRecipeWriteGate();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { form, setForm, recipeIngredients, handleChange, addIngredientRow, handleIngredientChange, removeIngredientRow } = useRecipeDraft();

  const [ingredientSearch, setIngredientSearch] = useState('');
  const ingredientSuggestions = useIngredientSuggestions(ingredientSearch);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const activeRef = useRef(true);
  const mutationRef = useRef(null);
  const [showModal, setShowModal] = useState(false);

  const tags = useRecipeTags();
  const { dietary: dietaryOpt, cuisines: cuisineOpt, categories: categoryOpt, loading: optionsLoading, error: optionsError } = tags;

  const [dietaryPref, setDietaryPref] = useState([]);
  const [cuisine, setCuisine] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      mutationRef.current?.abort();
    };
  }, []);

  const handleImgUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || savingRef.current || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setError(null);
    try {
      const imageUrl = await uploadRecipeImage(file, user?.id);
      if (activeRef.current) setForm((prev) => ({ ...prev, image_url: imageUrl }));
    } catch (error) {
      if (activeRef.current) setError(error.message || 'Could not upload the image.');
    } finally {
      uploadingRef.current = false;
      if (activeRef.current) setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current || uploadingRef.current) return;
    if (!user?.id) {
      setError('Please log in to save a recipe.');
      return;
    }
    const validated = validateRecipeForm(form, recipeIngredients);
    if (validated.error) {
      setError(validated.error);
      return;
    }
    savingRef.current = true;
    const controller = new AbortController();
    mutationRef.current = controller;
    setSaving(true);
    setError(null);
    try {
      await saveRecipe(validated, { dietaryPref, cuisine, categories, actorId: user.id, signal: controller.signal });
      if (!activeRef.current || controller.signal.aborted) return;
      setShowModal(true);
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not save the recipe. Please try again.');
    } finally {
      savingRef.current = false;
      if (mutationRef.current === controller) mutationRef.current = null;
      if (activeRef.current) setSaving(false);
    }
  };


  if (!writeGate.allowed) return <RecipeWriteGate state={writeGate} title="Create recipe" />;

  return (
    <main className="product-page product-recipe-form-page create-recipe-container">
      <header className="account-page-header lmc-page-header"><div><h1 className="product-page-title">Create a recipe</h1></div><Link to="/user-recipe" className="lmc-button lmc-button--quiet">My recipes</Link></header>
      {optionsError && <div className="product-status"><Alert as="p" className="error-message">{optionsError}</Alert><Button type="button" className="product-edit-toggle" disabled={saving || uploading} onClick={tags.retry}>Try again</Button></div>}
      <form onSubmit={handleSubmit} aria-busy={saving || uploading}>
        <fieldset disabled={saving || uploading} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div className="recipe-editor-panels"><section className="recipe-editor-panel" aria-labelledby="create-basics-heading"><h2 id="create-basics-heading">Recipe details</h2>
        <div className="form-group">
          <Field htmlFor="create-photo">Recipe photo</Field>
          <input id="create-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" ref={fileInputRef} onChange={handleImgUpload} />
          {uploading && <p role="status">Uploading image…</p>}
          {form.image_url && <RecipeImage src={form.image_url} alt="Your recipe preview" />}
        </div>

        <div className="form-group">
          <Field htmlFor="create-title">Title</Field>
          <input id="create-title" name="title" value={form.title} onChange={handleChange} required />
        </div>

        <div className="recipe-form-tags"><div className="form-group">
          <Field htmlFor="create-dietary">Dietary preferences</Field>
          <Select inputId="create-dietary" classNamePrefix="product-select" isLoading={optionsLoading} isDisabled={saving || uploading || optionsLoading || Boolean(optionsError)} isMulti options={dietaryOpt.map(opt => ({ value: opt.id, label: opt.name }))} onChange={setDietaryPref} />
        </div>

        <div className="form-group">
          <Field htmlFor="create-cuisines">Cuisines</Field>
          <Select inputId="create-cuisines" classNamePrefix="product-select" isLoading={optionsLoading} isDisabled={saving || uploading || optionsLoading || Boolean(optionsError)} isMulti options={cuisineOpt.map(opt => ({ value: opt.id, label: opt.name }))} onChange={setCuisine} />
        </div>

        <div className="form-group">
          <Field htmlFor="create-categories">Categories</Field>
          <Select inputId="create-categories" classNamePrefix="product-select" isLoading={optionsLoading} isDisabled={saving || uploading || optionsLoading || Boolean(optionsError)} isMulti options={categoryOpt.map(opt => ({ value: opt.id, label: opt.name }))} onChange={setCategories} />
        </div></div>

        <div className="form-group">
          <Field htmlFor="create-description">Description</Field>
          <textarea id="create-description" name="description" value={form.description} onChange={handleChange} />
        </div>

        </section><section className="recipe-editor-panel" aria-labelledby="create-method-heading"><h2 id="create-method-heading">Cooking method</h2>
        <div className="recipe-form-row"><div className="form-group">
          <Field htmlFor="create-servings">Servings</Field>
          <input type="number" id="create-servings" name="servings" min={1} value={form.servings} onChange={handleChange} />
        </div>

        <div className="form-group">
          <Field htmlFor="create-time">Cooking time (minutes)</Field>
          <input type="number" id="create-time" name="time" min={1} value={form.time} onChange={handleChange} />
        </div></div>

        <div className="form-group">
          <Field htmlFor="create-directions">Directions</Field>
          <p id="create-directions-help" className="recipe-field-help">One instruction per line.</p>
          <textarea id="create-directions" aria-describedby="create-directions-help" name="directions" value={form.directions} onChange={handleChange} type='text' required/>
        </div>

        <div className="checkbox-group">
          <input type="checkbox" id="create-public" name="is_public" checked={form.is_public} onChange={handleChange} />
          <Field htmlFor="create-public">Make this recipe public</Field>
        </div>

        </section></div>
        <section className="recipe-editor-ingredients" aria-labelledby="create-ingredients-heading"><h2 className="ingredients-title" id="create-ingredients-heading">Ingredients</h2>
        {recipeIngredients.map((ri, index) => (
          <div className="ingredient-row" key={index}>
            <input
              type="text"
              placeholder="Ingredient name"
              aria-label={`Ingredient ${index + 1} name`}
              value={ri.name}
              onChange={(e) => {
                handleIngredientChange(index, 'name', e.target.value);
                setIngredientSearch(e.target.value);
              }}
              list={`suggestions-${index}`}
            />
            <datalist id={`suggestions-${index}`}>
              {ingredientSuggestions.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>

            <input
              type="text"
              inputMode="decimal"
              placeholder="Quantity"
              aria-label={`Ingredient ${index + 1} quantity`}
              value={ri.quantity}
              onChange={(e) => handleIngredientChange(index, 'quantity', e.target.value)}
            />
            <select
              name="unit"
              aria-label={`Ingredient ${index + 1} unit`}
              value={ri.unit}
              onChange={(e) => handleIngredientChange(index, 'unit', e.target.value)}
            >
              <option value=''>Unit</option>
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
            <Button
              type="button"
              className="delete-ingredient-btn lmc-button lmc-button--quiet"
              aria-label={`Remove ingredient ${index + 1}`}
              onClick={() => removeIngredientRow(index)}
            >
              <FiMinus aria-hidden="true" size={18} />
            </Button>
          </div>
        ))}

        <Button type="button" className="add-ingredient-btn lmc-button lmc-button--secondary" onClick={addIngredientRow}>
          <FiPlus aria-hidden="true" size={18} /> Add ingredient
        </Button>
        </section>



        {error && <Alert as="p" className="error-message">{error}</Alert>}
        <div className="recipe-form-actions"><Button type="submit" className="lmc-button lmc-button--primary" disabled={saving || uploading}>{saving ? "Saving…" : "Save recipe"}</Button><Link to="/user-recipe" className="lmc-button lmc-button--secondary">Cancel</Link></div>
        </fieldset>
      </form>

      {showModal && (
        <Modal isOpen={showModal} title="Recipe saved" message="Your recipe is saved." onClose={() => navigate('/user-recipe')} />
      )}
    </main>
  );
}
