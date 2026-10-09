package com.server.letMeCook.service;
import java.util.Map;
import java.util.UUID;
/** Trusted snapshot port; the planner never depends on the kitchen application service. */
public interface PlanningContextPort {
    record Options(boolean pantry,boolean householdPreferences,boolean leftovers,boolean ownTaste) {
        public Options(boolean pantry,boolean householdPreferences,boolean leftovers){this(pantry,householdPreferences,leftovers,true);}
    }
    record Context(String contractVersion,Map<String,Object> fields) {
        public Context { fields=java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(fields)); }
    }
    Context load(UUID actor,UUID household,boolean lock,Options options);
}
