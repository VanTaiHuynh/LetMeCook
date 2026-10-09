"""One signed clarification round, preserving original hard restrictions."""
import hashlib
import hmac
import json
import os
import re
import time

from src.ai_errors import AIError
from src.ai_contracts import SearchIntent
from src.ai_config import CONTRACT_VERSION,DIETS,TRANSLATIONS

TTL_SECONDS=900


def unsupported_diet_error():
    error=AIError('That requested dietary label is not supported. Enter explicit ingredient exclusions or supported source labels.',422)
    error.code='unsupported_diet'
    return error


def reject_unsupported_diet(prompt):
    # Check the actual request before interpreting model output, so a model's
    # unsupported token cannot hide the stable requested-label error contract.
    if re.search(r'\b(?:keto|ketogenic|paleo|pescatarian|halal|kosher)\b',prompt.casefold()):
        raise unsupported_diet_error()


def explicit_diets(prompt):
    text=prompt.casefold()
    # Remove only the complete Vietnamese vegan phrase from vegetarian
    # detection: "thuần chay" requests vegan, not two independent source tags.
    vegetarian_text=re.sub(r'\bthuần\s+chay\b','',text)
    patterns={
        'vegan':r'\bvegan\b|\bthuần\s+chay\b',
        'vegetarian':r'\bvegetarian\b|\bchay\b',
        'gluten-free':r'\bgluten[-\s]+free\b',
        'low-fat':r'\blow[-\s]+fat\b|\bít\s+(?:chất\s+)?béo\b',
        'low-calorie':r'\blow[-\s]+calor(?:ie|ies)\b|\bít\s+(?:calo|ca[-\s]*lo|calories)\b'}
    return [diet for diet,pattern in patterns.items() if re.search(pattern,vegetarian_text if diet=='vegetarian' else text)]


def explicit_categories(prompt):
    text=prompt.casefold()
    patterns={
        'breakfast':r'\bbreakfast\b|\b(?:bữa|ăn)\s+sáng\b',
        'brunch':r'\bbrunch\b',
        'lunch':r'\blunch\b|\b(?:bữa|ăn)\s+trưa\b',
        'dinner':r'\bdinner\b|\b(?:bữa|ăn)\s+tối\b',
        'main course':r'\bmain\s+course\b|\bmón\s+chính\b',
        'soup':r'\bsoup\b|\bsúp\b|\bcanh\b',
        'side dish':r'\bside\s+dish\b|\bmón\s+phụ\b',
        'dessert':r'\bdessert\b|\btráng\s+miệng\b',
        'snack':r'\bsnack\b|\băn\s+vặt\b|\bbữa\s+phụ\b',
        'drink':r'\bdrink\b|\bđồ\s+uống\b'}
    return [category for category,pattern in patterns.items() if re.search(pattern,text)]


def explicit_guards(prompt,intent):
    """Recover syntactically explicit negation/diets/time, never infer safety.

    This limited deterministic safeguard complements extraction; it is not a
    claim that arbitrary English/Vietnamese meaning has been formally parsed.
    """
    from src import local_ai as ai
    result={key:list(value) if isinstance(value,list) else value for key,value in intent.items()}
    text=prompt.casefold()
    for match in re.finditer(r'(?:\bwithout\b|\bavoid(?:ing)?\b|\bexclude\b|\bexcluding\b|\ballergic to\b|\bno\b|\bdon[’\x27]t want\b|không(?: có| dùng| ăn)?|tránh|dị ứng(?: với)?)\s+([^.;!?\n]+)',text):
        clause=re.split(r'\b(?:under|within|with|but|for dinner|for lunch)\b|\b(?:and|or)\s+(?:use|add|include|cook|make)\b|(?:và|hoặc)\s+(?:dùng|thêm|có|nấu)|trong \d|nhưng',match.group(1))[0]
        for part in re.split(r',|\b(?:and|or|và|hoặc)\b',clause):
            part=re.sub(r'^(?:any|all|the|bất kỳ)\s+','',part).strip()
            part=re.sub(r'\s+(?:please|thank you)$','',part)
            if part in ('allergies','food allergies','dietary restrictions','restrictions','dị ứng','hạn chế'):continue
            if part and len(part)<=60:
                result['allergies']+=ai._terms([part])
    grounded_diets=explicit_diets(prompt)
    # Prompt extraction cannot invent a diet from "healthy", "light", tofu or
    # other ingredients. Manual/profile/signed constraints are merged later,
    # outside this prompt-only boundary and remain authoritative.
    result['dietaryPreferences']=list(dict.fromkeys([diet for diet in result['dietaryPreferences'] if diet in grounded_diets]+grounded_diets))
    result['categories']=list(dict.fromkeys(result['categories']+explicit_categories(prompt)))
    # Known unsupported requested labels stay explicit errors, never silently
    # disappear even when an extraction model omits them.
    reject_unsupported_diet(prompt)
    times=[int(match.group(1)) for match in re.finditer(r'(?:under|within|at most|less than|tối đa|dưới|trong)\s+(\d{1,3})\s*(?:minutes?|mins?|phút)',text)]
    if times:result['maxCookingTime']=min(times+[result['maxCookingTime']] if result['maxCookingTime'] else times)
    for key in ('allergies','dietaryPreferences'):result[key]=list(dict.fromkeys(result[key]))
    return result


def reasons(prompt,intent):
    from src.dietary_guards import listed_diet_conflict
    output=[]
    overlap=set(ingredient_conflicts(intent['ingredients'],intent['allergies']))
    if overlap:output.append(('ingredient_conflict','Your request both includes and excludes '+', '.join(sorted(overlap))+'. Which ingredient should be removed from the request?'))
    conflicts=[name for name in intent['ingredients'] if listed_diet_conflict(name,intent['dietaryPreferences'])]
    if conflicts:output.append(('diet_conflict','The requested source diet conflicts with '+', '.join(conflicts)+'. Should those ingredients be replaced with explicitly named plant alternatives?'))
    if re.search(r'\b(?:healthy|light|something nice|some food)\b|lành mạnh|món gì đó|ăn nhẹ',prompt.casefold()) and not any(intent.get(key) for key in ('ingredients','dietaryPreferences')) and intent['keyword'] in ('','healthy','light','something nice','some food'):
        output.append(('meal_goal','Which ingredients or supported dietary preference would you like to use?'))
    return output[:2]


def ingredient_conflicts(ingredients,exclusions):
    from src import local_ai as ai
    return [name for name in ingredients if any(re.search(ai.ingredient_pattern(term).replace(r'\m',r'\b').replace(r'\M',r'\b'),name,re.I) for term in exclusions)]


def _key():
    value=os.getenv('MEAL_PLANNER_SIGNING_KEY','')
    if len(value)<32:raise AIError('Signed local clarification is unavailable until its validation key is configured.',503)
    return value.encode()


def _signature(value):
    return hmac.new(_key(),json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode(),hashlib.sha256).hexdigest()


def response(prompt,intent,items):
    questions=[{'id':identifier,'question':question} for identifier,question in items[:2]]
    value={'originalPrompt':prompt,'originalIntent':intent,'questions':questions,'issuedAt':int(time.time()),'round':1}
    signed={**value,'signature':_signature(value)}
    return {'contractVersion':CONTRACT_VERSION,'status':'needs_clarification','intent':intent,'recipes':[],
            'totalMatches':0,'local':True,'warnings':['The request needs clarification; no restrictions have been relaxed.'],
            'clarification':{'questions':questions,'reasons':[identifier for identifier,_ in items[:2]],'context':signed}}


def resume(prompt,context,answers):
    if not isinstance(context,dict) or set(context)!={'originalPrompt','originalIntent','questions','issuedAt','round','signature'}:
        raise AIError('Clarification context is incomplete.')
    unsigned={key:value for key,value in context.items() if key!='signature'}
    if not isinstance(context['signature'],str) or not hmac.compare_digest(_signature(unsigned),context['signature']):
        raise AIError('Clarification context was changed. Start a new request.')
    if context['round']!=1 or type(context['issuedAt']) is not int or not 0<=time.time()-context['issuedAt']<=TTL_SECONDS or prompt!=context['originalPrompt']:
        raise AIError('Clarification expired or the original request changed. Start a new request.')
    original=SearchIntent.from_mapping(context['originalIntent']).to_dict()
    questions=context['questions']
    if not isinstance(questions,list) or not 1<=len(questions)<=2 or not isinstance(answers,dict) or set(answers)!={item['id'] for item in questions}:
        raise AIError('Answer each of the at most two clarification questions.')
    if any(not isinstance(value,str) or not value.strip() or len(value)>200 for value in answers.values()):
        raise AIError('Clarification answers must contain 1–200 characters.')
    combined=prompt+'\nClarification answers: '+ '; '.join(answers[item['id']].strip() for item in questions)
    if len(combined)>2500:raise AIError('Clarification request is too long. Shorten the original request and start again.')
    return original,combined


def preserve(original,updated):
    # Positive ingredients can be replaced by an explicit clarification; hard
    # exclusions/diets/time from the original signed request cannot be erased.
    from src.dietary_guards import listed_diet_conflict
    conflicts=ingredient_conflicts(original['ingredients'],original['allergies'])
    protected=[name for name in original['ingredients'] if name not in conflicts and not listed_diet_conflict(name,original['dietaryPreferences'])]
    updated['ingredients']=list(dict.fromkeys(protected+updated['ingredients']))
    if original['keyword']:updated['keyword']=original['keyword']
    for key in ('allergies','dietaryPreferences','cuisines','categories'):
        updated[key]=list(dict.fromkeys(original[key]+updated[key]))
    if original['maxCookingTime'] is not None:
        updated['maxCookingTime']=min(original['maxCookingTime'],updated['maxCookingTime'] or original['maxCookingTime'])
    return updated
