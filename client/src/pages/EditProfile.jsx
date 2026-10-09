import useIngredientLookup from "../utils/useIngredientLookup";
import { saveOwnProfile, setOwnProfileImage } from "../utils/accountMutations";
import Alert from "../components/ui/Alert";
import { ownProfile } from "../utils/accountApi";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import Select from 'react-select';
import { Link, Navigate, useNavigate } from "react-router-dom";
import Modal from '../components/Modal';

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free',
  'Halal', 'Kosher', 'Paleo', 'Keto', 'Low-Carb'
].map(option => ({ label: option, value: option }));

const COOKING_SKILL = ['beginner', 'home cook', 'skilled', 'chef', 'master chef'];

function EditProfileForm({ user }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    cooking_skill: '',
    about_me: '',
    dietary_pref: [],
    user_allergy: [],
    image_url: ''
  });
  const [error, setError] = useState(null);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const { items: ingredientsResults, error: ingredientError, loading: ingredientSearching } = useIngredientLookup(ingredientSearch);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const pendingRef = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; pendingRef.current?.abort(); }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setProfileLoading(true);
    setError(null);
    (async () => {
      try {
      const data = await ownProfile({ signal: controller.signal, actorId: user.id });
      if (!Array.isArray(data.allergyIngredients)) throw new Error('Your allergy choices could not be loaded. Retry before editing.');
      if (active) { setForm({ ...data, user_allergy: data.allergyIngredients }); setProfile(data); }
      } catch (error) {
        if (active) setError(error.message || 'Could not load your profile. Please try again.');
      } finally {
        if (active) setProfileLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [user.id, loadVersion]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const handleCookingLvl = (e) => {
    setForm({ ...form, cooking_skill: e.target.value });
  };

  const handleDietaryPreference = (selected) => {
    setForm({ ...form, dietary_pref: selected ? selected.map(s => s.value) : [] });
  };

  const handleAllergies = (selected) => {
    setForm({ ...form, user_allergy: (selected || []).map(s => ({ id: s.value, name: s.label })) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busyRef.current || !activeRef.current || !user?.id || !profile) return;
    busyRef.current = true;
    const controller = new AbortController(); pendingRef.current = controller;
    setSaving(true);
    setError(null);
    try {
    await saveOwnProfile(user.id,form,controller.signal);
    if (!activeRef.current || controller.signal.aborted) return;
    setProfile({ ...profile, ...form });
    setShowModal(true);
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not save your profile. Please try again.');
    } finally {
      pendingRef.current = null; busyRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };

  const handleImgUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || busyRef.current || !activeRef.current || !user?.id || !profile) return;
    busyRef.current = true;
    const controller = new AbortController(); pendingRef.current = controller;
    setUploading(true);
    setError(null);
    try {
    const fileExt = file.name.split('.').pop();
    const filepath = `${user.id}/${Date.now()}.${fileExt}`;

    const { error } = await supabase.storage
      .from('user-profile-images')
      .upload(filepath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) throw error;
    if (!activeRef.current || controller.signal.aborted) return;

    const { data: publicURLData } = supabase.storage
      .from('user-profile-images')
      .getPublicUrl(filepath);

    await setOwnProfileImage(user.id,publicURLData.publicUrl,controller.signal);
    if (!activeRef.current || controller.signal.aborted) return;
    setForm((previous) => ({ ...previous, image_url: publicURLData.publicUrl }));
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not upload your photo. Please try again.');
    } finally {
      pendingRef.current = null; busyRef.current = false;
      if (activeRef.current) setUploading(false);
    }
  };

  if (profileLoading) return <main className="product-page product-edit-profile-page edit-profile-container"><h1 className="product-page-title">Edit profile</h1><p role="status">Loading your profile…</p></main>;
  if (!profile) return <main className="product-page product-edit-profile-page edit-profile-container"><h1 className="product-page-title">Edit profile</h1><Alert as="p" className="error-message">{error || 'Your profile is unavailable.'}</Alert><Button type="button" className="product-edit-toggle" onClick={() => setLoadVersion((version) => version + 1)}>Try again</Button></main>;

  return (
    <main className="product-page product-edit-profile-page edit-profile-container">
      <header className="account-page-header lmc-page-header"><div><h1 className="product-page-title">Edit profile</h1></div><Link to="/profile" className="lmc-button lmc-button--quiet">View profile</Link></header>
      <form onSubmit={handleSubmit} aria-busy={saving || uploading}>
        <div className="profile-panels">
        <fieldset className="profile-form-section" disabled={saving || uploading}><legend>Personal details</legend>
        {form.image_url && (
          <img src={form.image_url} alt="Your profile preview" className="profile-preview" />
        )}
        <div className="profile-form-field"><Field htmlFor="profile-photo">Profile photo</Field>
        <input
          id="profile-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          ref={fileInputRef}
          onChange={handleImgUpload}
          disabled={uploading || saving}
        /></div>
        {uploading && <p role="status">Uploading your photo…</p>}

        <div className="profile-form-fields"><div className="profile-form-field"><Field htmlFor="profile-first_name">First name</Field>
        <input
          id="profile-first_name"
          autoComplete="given-name"
          disabled={uploading || saving}
          type="text"
          name="first_name"
          value={form.first_name || ''}
          onChange={handleChange}
          placeholder="First Name"
        /></div>
        <div className="profile-form-field"><Field htmlFor="profile-last_name">Last name</Field>
        <input
          id="profile-last_name"
          autoComplete="family-name"
          disabled={uploading || saving}
          type="text"
          name="last_name"
          value={form.last_name || ''}
          onChange={handleChange}
          placeholder="Last Name"
        /></div></div>
        <div className="profile-form-field"><Field htmlFor="profile-about">About me</Field>
        <textarea
          id="profile-about"
          name="about_me"
          disabled={uploading || saving}
          value={form.about_me || ''}
          onChange={handleChange}
          placeholder="About Me"
        /></div>

        </fieldset><fieldset className="profile-form-section" disabled={saving || uploading}><legend>Cooking preferences</legend><div className="profile-form-field"><Field htmlFor="profile-dietary">Dietary preferences</Field>
        <Select inputId="profile-dietary" classNamePrefix="product-select"
          name="dietary_pref"
          value={(form.dietary_pref || []).map(value => ({ label: value, value }))}
          isDisabled={uploading || saving}
          onChange={handleDietaryPreference}
          isMulti
          closeMenuOnSelect={false}
          options={DIETARY_OPTIONS}
          placeholder="Select Dietary Preferences"
        /></div>

        <div className="profile-form-field"><Field htmlFor="profile-skill">Cooking skill level</Field>
        <select
          id="profile-skill"
          name="cooking_skill"
          disabled={uploading || saving}
          value={form.cooking_skill}
          onChange={handleCookingLvl}
        >
          <option value="">Select Skill Level</option>
          {COOKING_SKILL.map((skill) => (
            <option key={skill} value={skill}>
              {skill}
            </option>
          ))}
        </select></div>

        <div className="profile-form-field"><Field htmlFor="profile-allergies">Ingredients to avoid</Field>
        <Select inputId="profile-allergies" classNamePrefix="product-select"
          name="allergies"
          isDisabled={uploading || saving}
          isLoading={ingredientSearching}
          value={(Array.isArray(form.user_allergy) ? form.user_allergy : [])
            .filter(a => a && a.id && a.name)
            .map(a => ({
              value: a.id,
              label: a.name
            }))}
          onChange={handleAllergies}
          onInputChange={(inputVal, actionMeta) => {
            if (actionMeta.action === 'input-change') {
              setIngredientSearch(inputVal);
            }
          }}
          isMulti
          closeMenuOnSelect={false}
          placeholder="Search for ingredients to avoid"
          noOptionsMessage={() =>
            ingredientError || (ingredientSearch ? 'No matching ingredients' : 'Type to search for an ingredient')
          }
          options={ingredientsResults.map(ingredient => ({
            value: ingredient.id,
            label: ingredient.name
          }))}
          menuPortalTarget={document.body}
          styles={{
            menuPortal: base => ({ ...base, zIndex: 80 }),
          }}
        /></div>
        {ingredientError && <Alert as="p" className="error-message">{ingredientError}</Alert>}
        </fieldset>
        </div>
        {error && <Alert as="p" className="error-message">{error}</Alert>}

        <div className="account-form-actions"><Button type="submit" className="lmc-button lmc-button--primary" disabled={saving || uploading}>{saving ? 'Saving…' : 'Save profile'}</Button><Link to="/profile" className="lmc-button lmc-button--secondary">Cancel</Link></div>
      </form>

      <Modal
        isOpen={showModal}
        message={"You've successfully updated your profile."}
        onClose={() => {
          setShowModal(false);
          navigate("/profile");
        }}
      />
    </main>
  );
}

export default function EditProfile() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page layout-wrapper"><h1 className="product-page-title">Edit profile</h1><p role="status">Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" state={{ from: { pathname: '/edit-profile' } }} replace/>;
  return <EditProfileForm key={user.id} user={user}/>;
}
