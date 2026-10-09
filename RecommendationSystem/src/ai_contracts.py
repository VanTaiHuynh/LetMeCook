"""Validated immutable v2 boundaries; mappings remain the legacy wire format."""
from dataclasses import dataclass
from types import MappingProxyType
import math
import uuid

from src.ai_errors import AIError
from src.ai_config import ARRAY_FIELDS, DIETS, CONTRACT_VERSION


@dataclass(frozen=True)
class SearchIntent:
    keyword: str
    lists: object
    max_cooking_time: object

    @classmethod
    def from_mapping(cls, value):
        from src.ai_intent import _terms
        required={'keyword',*ARRAY_FIELDS,'maxCookingTime'}
        if not isinstance(value,dict) or set(value)!=required:
            raise AIError('Search constraints do not match the versioned contract.',502)
        keyword=value['keyword']
        if not isinstance(keyword,str) or len(keyword)>120:
            raise AIError('Invalid dish name in search constraints.',502)
        fields={key:tuple(_terms(value[key])) for key in ARRAY_FIELDS}
        if any(diet not in DIETS for diet in fields['dietaryPreferences']):
            raise AIError('Unsupported dietary preference. Use a supported label or explicit exclusions.',422)
        maximum=value['maxCookingTime']
        if maximum is not None and (type(maximum) is not int or not 1<=maximum<=600):
            raise AIError('Cooking time must be between 1 and 600 minutes.',422)
        return cls(keyword,MappingProxyType(fields),maximum)

    def to_dict(self):
        return {'keyword':self.keyword,**{key:list(value) for key,value in self.lists.items()},
                'maxCookingTime':self.max_cooking_time}


@dataclass(frozen=True)
class TasteContext:
    preferred_ingredients: tuple=()
    avoided_ingredients: tuple=()
    preferred_cuisines: tuple=()
    feedback: tuple=()

    @classmethod
    def from_mapping(cls, profile):
        from src.ai_intent import _terms
        if not isinstance(profile,dict):raise AIError('Trusted taste context must be an object.')
        signals=profile.get('tasteSignals',{})
        if not isinstance(signals,dict) or set(signals)-{'preferredIngredients','avoidedIngredients','preferredCuisines'}:
            raise AIError('Taste signals contain unsupported fields.')
        values=[]
        for key,limit,max_chars in [('preferredIngredients',20,120),('avoidedIngredients',20,120),('preferredCuisines',10,100)]:
            raw=signals.get(key,[])
            if not isinstance(raw,list) or len(raw)>limit or any(not isinstance(item,str) or not item.strip() or len(item)>max_chars for item in raw):
                raise AIError('Taste signal names are invalid or too long.')
            values.append(tuple(dict.fromkeys(_terms([item])[0] if len(item)<=60 else item.strip().casefold() for item in raw)))
        feedback=profile.get('tasteFeedback',[])
        if not isinstance(feedback,list) or len(feedback)>100:raise AIError('Taste feedback is too large.')
        result=[]
        seen=set()
        for item in feedback:
            if not isinstance(item,dict) or set(item)-{'recipeId','rating'}:raise AIError('Taste feedback is invalid.')
            try:identifier=str(uuid.UUID(item.get('recipeId')))
            except (ValueError,TypeError,AttributeError) as error:raise AIError('Taste feedback recipe ID is invalid.') from error
            rating=item.get('rating')
            if type(rating) not in (int,float) or not math.isfinite(rating) or not 1<=rating<=5:
                raise AIError('Taste feedback must contain a real rating between 1 and 5.')
            if identifier in seen:raise AIError('Taste feedback contains duplicate recipe IDs.')
            seen.add(identifier);result.append((identifier,float(rating)))
        return cls(*values,tuple(result))

    def to_preferences(self):
        return {'preferredIngredients':list(self.preferred_ingredients),
                'avoidedIngredients':list(self.avoided_ingredients),
                'preferredCuisines':list(self.preferred_cuisines),
                'tasteFeedback':[{'recipeId':identifier,'rating':rating} for identifier,rating in self.feedback]}


@dataclass(frozen=True)
class VisionObservation:
    name:str
    confidence:str

    @classmethod
    def from_mapping(cls,value):
        from src.ai_intent import _terms
        if not isinstance(value,dict) or set(value)!={'name','confidence'} or value['confidence'] not in {'high','medium','low'}:
            raise AIError('Local vision returned an invalid observation contract.',502)
        return cls(_terms([value['name']])[0],value['confidence'])

    def to_dict(self):return {'name':self.name,'confidence':self.confidence}


def results_envelope(**fields):
    return {'contractVersion':CONTRACT_VERSION,'status':'results',**fields}
