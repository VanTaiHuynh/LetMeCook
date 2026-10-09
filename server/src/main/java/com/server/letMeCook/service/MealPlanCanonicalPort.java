package com.server.letMeCook.service;
import java.util.Map;
import org.springframework.security.oauth2.jwt.Jwt;
/** Canonical planning application port used by coverage without a service cycle. */
public interface MealPlanCanonicalPort {
    Map<String,Object> recalculate(Map<String,Object> request,Jwt actor);
}
