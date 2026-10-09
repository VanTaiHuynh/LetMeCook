import { FiPlus, FiMinus } from "react-icons/fi";
import useRecipeDraft, { RECIPE_UNITS as UNITS } from "../features/editor/useRecipeDraft";
import Alert from "../components/ui/Alert";
import { accountRequest } from "../utils/accountApi";
import { recipeReadClient } from "../utils/recipeReadClient";
import { useIngredientSuggestions } from "../features/editor/useRecipeEditorResources";
import { recipeTagOptions } from "../utils/catalogApi";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import RecipeWriteGate from "../components/RecipeWriteGate";
import useRecipeWriteGate from "../utils/useRecipeWriteGate";
import RecipeImage from "../components/RecipeImage";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { deleteOwnRecipe } from '../utils/accountMutations';
import Modal from '../components/Modal';
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import Select from 'react-select';
import './RecipeForm.css';
import { validateRecipeForm } from '../utils/recipeForm';
import { saveRecipe, uploadRecipeImage } from '../utils/recipeMutations';
import { recipeSteps, recipeText } from '../utils/recipeContent';




export default function EditRecipe() {
  const { user, loading } = useAuth();
  const { id: recipeId } = useParams();
  if (loading) return <main className="product-page product-recipe-form-page create-recipe-container"><h1 className="product-page-title">Edit recipe</h1><p role="status">Loading your account…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: `/edit-recipe/${recipeId}` }} />;
  return <EditRecipeForm key={`${user.id}:${recipeId}`} user={user} recipeId={recipeId} />;
}

function EditRecipeForm({ user, recipeId }) {
  const writeGate = useRecipeWriteGate();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const { form, setForm, recipeIngredients, setRecipeIngredients, handleChange, addIngredientRow, handleIngredientChange, removeIngredientRow } = useRecipeDraft();

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
  const [modalMessage, setModalMessage] = useState('');
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [dietaryOpt, setDietaryOpt] = useState([]);
  const [cuisineOpt, setCuisineOpt] = useState([]);
  const [categoryOpt, setCategoryOpt] = useState([]);

  const [dietaryPref, setDietaryPref] = useState([]);
  const [cuisine, setCuisine] = useState([]);
  const [categories, setCategories] = useState([]);

  const [isAuthorized, setIsAuthorized] = useState(true);
  const [recipeLoaded, setRecipeLoaded] = useState(false);
  const [recipeLoading, setRecipeLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      mutationRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const fetchRecipeData = async () => {
      setRecipeLoading(true);
      setRecipeLoaded(false);
      setError(null);
      try {
      const tags = await recipeTagOptions(controller.signal);
      if (!active) return;
      const { dietary: dietaryOptions, cuisines: cuisineOptions, categories: categoryOptions } = tags;

      setDietaryOpt(dietaryOptions || []);
      setCuisineOpt(cuisineOptions || []);
      setCategoryOpt(categoryOptions || []);

      const [data, state] = await Promise.all([
        recipeReadClient.detail(recipeId, { signal: controller.signal, userId: user.id }),
        accountRequest(`/recipes/${recipeId}/state`, { signal: controller.signal, actorId: user.id, contractVersion: 'account.v1' }),
      ]);
      if (!active || controller.signal.aborted) return;
      if (!state.owned) { setIsAuthorized(false); return; }
      setIsAuthorized(true);
      setForm({ title: data.title, description: recipeText(data.description), servings: data.servings > 0 ? data.servings : '',
        is_public: data.public === true, image_url: data.imageUrl || '', directions: recipeSteps(data.directions).join('\n'), time: data.cookingTime > 0 ? data.cookingTime : '' });
      setRecipeIngredients(data.ingredients.map(item => ({ name: item.ingredientName || '', ingredient_id: null, quantity: item.quantity || '', unit: item.unit || '' })));
      const selectTags = (names, options) => (names || []).map(name => options.find(option => option.name === name)).filter(Boolean).map(item => ({ value: item.id, label: item.name }));
      setDietaryPref(selectTags(data.dietaryPreferences, dietaryOptions)); setCuisine(selectTags(data.cuisines, cuisineOptions)); setCategories(selectTags(data.categories, categoryOptions));
      if (active) setRecipeLoaded(true);
      } catch (error) {
        if (active) setError(error.message || 'Could not load the recipe.');
      } finally {
        if (active) setRecipeLoading(false);
      }
    };

    if (recipeId) fetchRecipeData();
    return () => { active = false; controller.abort(); };
  }, [recipeId, user.id, loadVersion, setForm, setRecipeIngredients]);

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
      await saveRecipe(validated, { recipeId, dietaryPref, cuisine, categories, actorId: user.id, signal: controller.signal });
      if (!activeRef.current || controller.signal.aborted) return;
      setModalMessage('Recipe updated successfully!');
      setShowModal(true);
      setModalType('success');
      setShouldRedirect(true);
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not save the recipe. Please try again.');
    } finally {
      savingRef.current = false;
      if (mutationRef.current === controller) mutationRef.current = null;
      if (activeRef.current) setSaving(false);
    }
  };

  const confirmDelete = () => {
    setModalType("confirm-delete");
    setModalMessage("Are you sure you want to delete this recipe?");
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (savingRef.current || uploadingRef.current || !user?.id || !recipeLoaded) return;
    savingRef.current = true;
    const controller = new AbortController();
    mutationRef.current = controller;
    setSaving(true);
    try {
    await deleteOwnRecipe(recipeId,user.id,controller.signal);
    if (!activeRef.current || controller.signal.aborted) return;

    setModalMessage("Recipe deleted successfully.");
    setModalType("success");
    setShowModal(true);
    setShouldRedirect(true);
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not delete the recipe.');
    } finally {
      savingRef.current = false;
      if (mutationRef.current === controller) mutationRef.current = null;
      if (activeRef.current) setSaving(false);
    }
  };


  useEffect(() => {
    if (!isAuthorized) {
      navigate('/forbidden');
    }
  }, [isAuthorized, navigate]);

  if (recipeLoading) return <main className="product-page product-recipe-form-page create-recipe-container"><h1 className="product-page-title">Edit recipe</h1><p role="status">Loading your recipe…</p></main>;
  if (!recipeLoaded) return <main className="product-page product-recipe-form-page create-recipe-container"><h1 className="product-page-title">Edit recipe</h1><Alert as="p" className="error-message">{error || 'Recipe unavailable.'}</Alert><Button type="button" className="product-edit-toggle" onClick={() => setLoadVersion((value) => value + 1)}>Try again</Button></main>;

  if (!writeGate.allowed) return <RecipeWriteGate state={writeGate} title="Edit recipe" />;

  return (
    <main className="product-page product-recipe-form-page create-recipe-container">
      <header className="account-page-header lmc-page-header"><div><h1 className="product-page-title">Edit your recipe</h1></div><Link to="/user-recipe" className="lmc-button lmc-button--quiet">My recipes</Link></header>
      <form onSubmit={handleSubmit} aria-busy={saving || uploading}>
        <fieldset disabled={saving || uploading} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div className="recipe-editor-panels"><section className="recipe-editor-panel" aria-labelledby="edit-basics-heading"><h2 id="edit-basics-heading">Recipe details</h2>
        <div className="form-group">
          <Field htmlFor="edit-photo">Recipe photo</Field>
          <input
          id="edit-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          ref={fileInputRef}
          onChange={handleImgUpload}
          />
          {uploading && <p role="status">Uploading image…</p>}
          {form.image_url && (
            <RecipeImage src={form.image_url} alt="Your recipe preview" />
          )}
        </div>

        <div className='form-group'>
          <Field htmlFor="edit-title">Title</Field>
          <input
            type="text"
            id="edit-title" name="title"
            value={form.title}
            onChange={handleChange}
            placeholder="Title"
            required
          />
        </div>

       <div className='form-group'>
        <Field htmlFor="edit-description">Description</Field>
        <textarea
          id="edit-description" name="description"
          value={form.description}
          onChange={handleChange}
          placeholder="Description"
        />
       </div>

        <div className="recipe-form-tags"><div className='form-group'>
          <Field htmlFor="edit-dietary">Dietary preferences</Field>
          <Select inputId="edit-dietary" classNamePrefix="product-select"
          isDisabled={saving || uploading}
            isMulti
            value={dietaryPref}
            options={dietaryOpt.map((opt) => ({
              value: opt.id,
              label: opt.name
            }))}
            onChange={setDietaryPref}
          />
        </div>
        <div className='form-group'>
          <Field htmlFor="edit-cuisines">Cuisines</Field>
          <Select inputId="edit-cuisines" classNamePrefix="product-select"
          isDisabled={saving || uploading}
            isMulti
            value={cuisine}
            options={cuisineOpt.map((opt) => ({
              value: opt.id,
              label: opt.name
            }))}
            onChange={setCuisine}
          />
        </div>

        <div className='form-group'>
          <Field htmlFor="edit-categories">Categories</Field>
          <Select inputId="edit-categories" classNamePrefix="product-select"
          isDisabled={saving || uploading}
            isMulti
            value={categories}
            options={categoryOpt.map((opt) => ({
            value: opt.id,
            label: opt.name
          }))}
          onChange={setCategories}
        />
        </div></div>

        </section><section className="recipe-editor-panel" aria-labelledby="edit-method-heading"><h2 id="edit-method-heading">Cooking method</h2>
        <div className="recipe-form-row"><div className='form-group'>
        <Field htmlFor="edit-servings">Servings</Field>
        <input
          type="number"
          id="edit-servings" name="servings"
          value={form.servings}
          onChange={handleChange}
          placeholder="Servings"
          min={1}
        />
        </div>
        <div className='form-group'>
        <Field htmlFor="edit-time">Cooking time (minutes)</Field>
        <input
          type="number"
          id="edit-time" name="time"
          value={form.time}
          onChange={handleChange}
          placeholder="Time (min)"
          min={1}
        />
        </div></div>
        <div className='form-group'>
        <Field htmlFor="edit-directions">Directions</Field>
        <p id="edit-directions-help" className="recipe-field-help">One instruction per line.</p>
        <textarea
          aria-describedby="edit-directions-help"
          id="edit-directions" name="directions"
          value={form.directions}
          onChange={handleChange}
          placeholder="Directions"
          type='text'
          required
        />
        </div>

        <div className='form-group'>
        <Field>
          <input
            type="checkbox"
            name="is_public"
            checked={form.is_public}
            onChange={handleChange}
          />
          Make this recipe public
        </Field>
        </div>

        </section></div>
        <section className="recipe-editor-ingredients" aria-labelledby="edit-ingredients-heading"><h2 className="ingredients-title" id="edit-ingredients-heading">Ingredients</h2>
        {recipeIngredients.map((ri, index) => (
          <div key={index} className="ingredient-row">
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
              <option value="">Unit</option>
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
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
        <Button
          type="button"
          onClick={addIngredientRow}
          className="add-ingredient-btn lmc-button lmc-button--secondary"
        >
          <FiPlus aria-hidden="true" size={18} /> Add ingredient
        </Button>
        </section>


        {error && <Alert as="p" className="error-message">{error}</Alert>}
        <div className="recipe-form-actions"><Button type="submit" className="lmc-button lmc-button--primary" disabled={saving || uploading}>{saving ? "Saving…" : "Save changes"}</Button><Link to="/user-recipe" className="lmc-button lmc-button--secondary">Cancel</Link></div>
        <section className="recipe-danger-zone"><h2>Delete recipe</h2><p>Permanently remove this recipe.</p><Button type="button" className="lmc-button lmc-button--danger" onClick={confirmDelete} disabled={saving || uploading}>Delete recipe</Button></section>
        </fieldset>
      </form>

      {showModal && (
        <Modal
          isOpen={showModal}
          message={modalMessage}
          showConfirmButtons={modalType === "confirm-delete"}
          title={modalType === "confirm-delete" ? "Delete recipe?" : "Recipe update"}
          confirmLabel="Delete recipe"
          confirmVariant="danger"
          onConfirm={modalType === "confirm-delete" ? handleDelete : undefined}
          onClose={() => {
            setShowModal(false);
            if (modalType === 'success' && shouldRedirect) {
              navigate("/user-recipe");
            }
            setShouldRedirect(false);
            setModalType(null);
          }}
        />
      )}
    </main>
  );
}
