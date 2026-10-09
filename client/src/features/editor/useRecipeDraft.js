import { useState } from 'react';
export const RECIPE_UNITS = ['teaspoon','cup','ounce','pound','pinch','Tbsps','serving','kilo','cloves','package','box','sprigs','mediums','qty','stick','slice','bunch','can','jar','gram','kilogram','millilitre','litre','tablespoon'];
const ingredient = () => ({name:'',ingredient_id:null,quantity:'',unit:''});
export default function useRecipeDraft() {
  const [form,setForm] = useState({title:'',description:'',servings:'',is_public:false,image_url:'',directions:'',time:''});
  const [recipeIngredients,setRecipeIngredients] = useState([ingredient()]);
  const handleChange = event => { const {name,value,type,checked} = event.target; setForm(previous=>({...previous,[name]:type==='checkbox'?checked:value})); };
  const addIngredientRow = () => setRecipeIngredients(previous=>[...previous,ingredient()]);
  const handleIngredientChange = (index,field,value) => setRecipeIngredients(previous=>previous.map((row,position)=>position===index?{...row,[field]:value,ingredient_id:null}:row));
  const removeIngredientRow = index => setRecipeIngredients(previous=>previous.filter((_,position)=>position!==index));
  return {form,setForm,recipeIngredients,setRecipeIngredients,handleChange,addIngredientRow,handleIngredientChange,removeIngredientRow};
}
