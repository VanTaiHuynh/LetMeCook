package com.server.letMeCook.security;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

/** Identities come from the verified token, never from a caller-supplied user ID. */
public final class RequestIdentity {
    private RequestIdentity() { }

    public static UUID optionalUserId(Jwt jwt) {
        if (jwt == null) return null;
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid user identity");
        }
    }

    public static UUID requireOwner(Jwt jwt, UUID requestedUserId) {
        UUID authenticatedId = optionalUserId(jwt);
        if (authenticatedId == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to access your account");
        }
        if (!authenticatedId.equals(requestedUserId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "This account belongs to another user");
        }
        return authenticatedId;
    }
}
