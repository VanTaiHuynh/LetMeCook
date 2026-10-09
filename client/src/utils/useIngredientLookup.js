import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
/** Bounded public autocomplete; no Java ingredient-search contract exists yet. */
export default function useIngredientLookup(input) {
  const [state,setState]=useState({input:'',items:[],loading:false,error:''});
  useEffect(()=>{
    setState({input,items:[],loading:!!input.trim(),error:''});if(!input.trim())return;
    const controller=new AbortController();const timer=setTimeout(async()=>{
      try {
        const escaped=input.trim().replace(/[%,_\\]/g,value=>`\\${value}`);
        const {data,error}=await supabase.from('ingredients').select('id,name').ilike('name',`%${escaped}%`).limit(10).abortSignal(controller.signal);
        if(error)throw error;if(!controller.signal.aborted)setState({input,items:data||[],loading:false,error:''});
      }catch(error){if(!controller.signal.aborted)setState({input,items:[],loading:false,error:error.message||'Ingredient search is unavailable. Try again.'});}
    },300);
    return()=>{clearTimeout(timer);controller.abort();};
  },[input]);
  return state.input===input?state:{items:[],loading:!!input.trim(),error:''};
}
