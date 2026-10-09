"""Preview only user-confirmed cooked portions; never debit raw ingredients."""
from dataclasses import dataclass
from datetime import date,timedelta,datetime
import math
import uuid

from src.ai_errors import AIError


@dataclass(frozen=True)
class ConfirmedLeftover:
    identifier:str
    version:int
    recipe_id:str
    servings:float
    use_by:date
    cooked_on:date

    def allocation(self,servings):
        return {'leftoverId':self.identifier,'version':self.version,
                'recipeId':self.recipe_id,'servingsUsed':servings}


def records(profile):
    values=profile.get('confirmedLeftovers',[])
    if not isinstance(values,list) or len(values)>1000:raise AIError('Confirmed leftover context is too large.')
    result=[];seen=set()
    for item in values:
        if not isinstance(item,dict):raise AIError('Confirmed leftover context is invalid.')
        try:
            identifier=str(uuid.UUID(item['id']));recipe=str(uuid.UUID(item['recipeId']))
            version=item['version'];quantity=item['servingsAvailable']
            if type(version) is not int or version<1 or type(quantity) not in (int,float) or not math.isfinite(quantity) or not 0<quantity<=1000 or not isinstance(item.get('confirmedAt'),str):raise ValueError()
            confirmed=datetime.fromisoformat(item['confirmedAt'].replace('Z','+00:00'))
            if confirmed.tzinfo is None:raise ValueError()
            if identifier in seen:raise ValueError()
            seen.add(identifier)
            # No shelf-life date is fabricated. Undated confirmed stock cannot
            # be scheduled for a dated future meal automatically.
            if not item.get('useBy'):continue
            expiry=date.fromisoformat(item['useBy'])
            cooked=date.fromisoformat(item['cookedOn'])
            if expiry<cooked:raise ValueError()
            result.append(ConfirmedLeftover(identifier,version,recipe,float(quantity),expiry,cooked))
        except (KeyError,TypeError,ValueError,OverflowError) as error:
            raise AIError('Confirmed leftover identity, quantity or dates are invalid.') from error
    return sorted(result,key=lambda item:(item.use_by,item.identifier))


def allocate(profile,first,servings,rows,meal_count):
    by_id={row['id']:row for row in rows};remaining={};selected=[];reuse={}
    stock=records(profile)
    for day in range(meal_count):
        planned=first+timedelta(days=day)
        for item in stock:
            available=remaining.get(item.identifier,item.servings)
            if item.recipe_id in by_id and item.cooked_on<=planned<=item.use_by and available>=servings:
                selected.append((day,by_id[item.recipe_id]));reuse[day]=item.allocation(servings)
                remaining[item.identifier]=available-servings
                break
    return selected,reuse


def validate_selected(profile,first,servings,selections):
    stock={item.identifier:item for item in records(profile)};remaining={};reuse={}
    for meal in selections:
        if not meal.get('leftoverId'):continue
        try:identifier=str(uuid.UUID(meal['leftoverId']))
        except (ValueError,TypeError,AttributeError) as error:raise AIError('Leftover selection ID is invalid.') from error
        item=stock.get(identifier);day=meal['dayIndex']
        if (item is None or meal.get('leftoverVersion')!=item.version or meal['recipeId']!=item.recipe_id or
                not item.cooked_on<=first+timedelta(days=day)<=item.use_by or remaining.get(identifier,item.servings)<servings):
            raise AIError('Selected leftovers changed, expired or no longer have enough confirmed portions. Refresh the plan.',422)
        remaining[identifier]=remaining.get(identifier,item.servings)-servings
        reuse[day]=item.allocation(servings)
    return reuse
