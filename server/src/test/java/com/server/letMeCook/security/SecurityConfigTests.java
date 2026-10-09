package com.server.letMeCook.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import static org.junit.jupiter.api.Assertions.*;

class SecurityConfigTests {
    private static final String SECRET = "local-test-jwt-secret-at-least-32-characters";
    private static final String ISSUER = "http://127.0.0.1:56421/auth/v1";
    private static final String AUDIENCE = "authenticated";

    private JWTClaimsSet claims(String issuer, String audience, Instant expires) {
        return new JWTClaimsSet.Builder().subject("local-user").issuer(issuer).audience(audience)
                .expirationTime(Date.from(expires)).issueTime(Date.from(Instant.now())).build();
    }

    private String hmacToken(String secret, String issuer, String audience, Instant expires) throws JOSEException {
        SignedJWT token = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims(issuer, audience, expires));
        token.sign(new MACSigner(secret.getBytes(StandardCharsets.UTF_8)));
        return token.serialize();
    }

    @Test
    void validatesLocalSupabaseSignatureIssuerAudienceAndExpiration() throws Exception {
        JwtDecoder decoder = new SecurityConfig().jwtDecoder(SECRET, ISSUER, "unused", AUDIENCE);
        Instant future = Instant.now().plusSeconds(600);
        assertEquals("local-user", decoder.decode(hmacToken(SECRET, ISSUER, AUDIENCE, future)).getSubject());
        assertThrows(JwtException.class, () -> decoder.decode(hmacToken(SECRET + "wrong", ISSUER, AUDIENCE, future)));
        assertThrows(JwtException.class, () -> decoder.decode(hmacToken(SECRET, "https://wrong.example/auth/v1", AUDIENCE, future)));
        assertThrows(JwtException.class, () -> decoder.decode(hmacToken(SECRET, ISSUER, "anon", future)));
        assertThrows(JwtException.class, () -> decoder.decode(hmacToken(SECRET, ISSUER, AUDIENCE, Instant.now().minusSeconds(600))));
    }

    @Test
    void validatesAsymmetricSupabaseTokensUsingThePublicJwks() throws Exception {
        ECKey key = new ECKeyGenerator(Curve.P_256).keyID("local-es256").generate();
        byte[] jwks = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth/v1/.well-known/jwks.json", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, jwks.length);
            try (var body = exchange.getResponseBody()) { body.write(jwks); }
        });
        server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/auth/v1/.well-known/jwks.json";
            JwtDecoder decoder = new SecurityConfig().jwtDecoder("", ISSUER, url, AUDIENCE);
            SignedJWT token = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(key.getKeyID()).build(),
                    claims(ISSUER, AUDIENCE, Instant.now().plusSeconds(600)));
            token.sign(new ECDSASigner(key));
            assertEquals("local-user", decoder.decode(token.serialize()).getSubject());
        } finally {
            server.stop(0);
        }
    }
}
