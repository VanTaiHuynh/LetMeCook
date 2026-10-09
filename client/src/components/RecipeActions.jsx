import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Alert from "./ui/Alert";
import Button from "./ui/Button";
import { useAuth } from "../context/AuthContext";
import { accountRequest } from "../utils/accountApi";
import { favoriteMutation } from "../utils/accountMutations";
import { kitchenRequest } from "../utils/kitchenApi";
import { mealSlotFromParams } from "../utils/kitchen";

// An actor or recipe change replaces the action state and aborts pending work.
const RecipeActions = forwardRef(function RecipeActions({ recipe, onCook, cookingSessionId = null, cookingOpen = false }, ref) {
  const { user } = useAuth();
  return <RecipeActionState ref={ref} key={`${recipe.id}:${user?.id || "guest"}`} recipe={recipe} user={user} onCook={onCook} cookingSessionId={cookingSessionId} cookingOpen={cookingOpen} />;
});
export default RecipeActions;

const RecipeActionState = forwardRef(function RecipeActionState({ recipe, user, onCook, cookingSessionId, cookingOpen }, ref) {
  const userId = user?.id || null;
  const [authorId, setAuthorId] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const cookingParams = new URLSearchParams(location.search);
  const [actionError,setActionError] = useState('');
  const [busy,setBusy] = useState('');
  const actionRequest = useRef(null);
  useEffect(() => () => { actionRequest.current?.abort(); actionRequest.current = null; }, [recipe.id,userId]);
  const startCooking = async (focusPanel = true) => {
    if (!user || cookingSessionId) { onCook?.(cookingSessionId, focusPanel); return; }
    if (actionRequest.current) return;
    const controller = new AbortController(); actionRequest.current = controller; setBusy('cook'); setActionError('');
    try {
      const requestedServings = Number(cookingParams.get('servings'));
      const mealSlot = mealSlotFromParams(cookingParams);
      const session = await kitchenRequest('/sessions',{householdId:cookingParams.get('householdId'),body:{recipeId:recipe.id,servings:Number.isInteger(requestedServings)&&requestedServings>=1&&requestedServings<=12 ? requestedServings : Math.max(1,Math.min(12,Math.round(recipe.servings||2))),...(mealSlot ? {mealSlot} : {})},signal:controller.signal});
      if (!controller.signal.aborted) onCook?.(session.id, focusPanel);
    } catch (error) { if (!controller.signal.aborted) setActionError(error.message); }
    finally { if (actionRequest.current === controller) { actionRequest.current = null; if (!controller.signal.aborted) setBusy(''); } }
  };
  useImperativeHandle(ref, () => ({ openCooking: startCooking }));

  useEffect(() => {
    const controller = new AbortController(); setAuthorId(''); setIsSaved(false); setActionError(''); setBusy('');
    if (userId && recipe?.id) accountRequest(`/recipes/${recipe.id}/state`, { signal: controller.signal, actorId: userId, contractVersion: 'account.v1' })
      .then(value => { if (!controller.signal.aborted) { setAuthorId(value.owned ? userId : ''); setIsSaved(value.favorite === true); } })
      .catch(error => { if (!controller.signal.aborted) setActionError(error.message); });
    return () => controller.abort();
  }, [recipe.id, userId]);

  const handleSave = async () => {
    if (isSaved || !user || actionRequest.current) return;
    const controller = new AbortController(); actionRequest.current = controller; setBusy('save'); setActionError('');
    try {
      await favoriteMutation(recipe.id,user.id,{signal:controller.signal});
      if(controller.signal.aborted)return;
      setIsSaved(true);
    } catch {if(!controller.signal.aborted)setActionError('Could not save this recipe. Please try again.');}
    finally {if(actionRequest.current===controller){actionRequest.current=null;if(!controller.signal.aborted)setBusy('');}}
  };

  const handlePrint = () => window.print();

  return (
    <div className="recipe-action-rail" role="group" aria-label="Recipe actions" aria-busy={Boolean(busy)}>
          <div className="recipe-detail-actions">
            <Button type="button" className="lmc-button lmc-button--primary" disabled={Boolean(busy)} aria-expanded={cookingOpen} aria-controls="recipe-cook-along" onClick={() => startCooking()}>{busy === "cook" ? "Starting…" : cookingOpen ? "Return to cooking" : "Cook along"}</Button>
            <Link to="/meal-planner" className="lmc-button lmc-button--secondary">Plan your week</Link>
            <Button type="button" className="lmc-button lmc-button--quiet" onClick={handlePrint}>
              Print recipe
            </Button>

            {user?.id === authorId && (
              <Button
                type="button" className="lmc-button lmc-button--quiet"
                onClick={() => navigate(`/edit-recipe/${recipe.id}`)}
              >
                Edit recipe
              </Button>
            )}

            {isSaved ? (
              <Link to="/favourites" className="save-btn saved lmc-button lmc-button--secondary">
                View favorites
              </Link>
            ) : !user ? (
              <Link to="/login" state={{from:{pathname:`/recipes/${recipe.id}`,search:location.search}}} className="lmc-button lmc-button--secondary">Log in to save</Link>
            ) : (
              <Button
                type="button"
                className="save-btn lmc-button lmc-button--secondary"
                onClick={handleSave}
                disabled={!user || Boolean(busy)}
                title={!user ? "Log in to save this recipe" : "Save this recipe"}
              >
                {busy === "save" ? "Saving…" : "Save recipe"}
              </Button>
            )}
          </div>
          {actionError && <Alert as="p" className="product-status">{actionError}</Alert>}
    </div>
  );
});
