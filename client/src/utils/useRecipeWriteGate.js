import { useEffect, useState } from 'react';
import { platformRequest } from './platform';
export default function useRecipeWriteGate() {
  const [state,setState]=useState({loading:true,allowed:false,error:''});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setState({loading:true,allowed:false,error:''});
    platformRequest('config', {signal:controller.signal}).then(flags=>{
      if(typeof flags.publicDemo!=='boolean')throw new Error('Recipe editing controls are unavailable.');
      if(!controller.signal.aborted)setState({loading:false,allowed:flags.publicDemo===false,error:''});
    }).catch(error=>{if(!controller.signal.aborted)setState({loading:false,allowed:false,error:error.message});});
    return()=>controller.abort();
  },[retry]);
  return {...state,retry:()=>setRetry(value=>value+1)};
}
