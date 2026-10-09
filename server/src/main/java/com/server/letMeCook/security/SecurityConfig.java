package com.server.letMeCook.security;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;
import jakarta.servlet.DispatcherType;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;


@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean public com.server.letMeCook.service.AIRequestRegistry aiRequestRegistry(){return new com.server.letMeCook.service.AIRequestRegistry();}



    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,com.server.letMeCook.service.AIRequestRegistry controls) throws Exception {
        return http
                .cors(Customizer.withDefaults())
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(exception -> exception
                        .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/recipes/recommendation/**", "/api/recipes/flask-update-embed")
                            .hasAuthority("ROLE_ADMIN")
                        .requestMatchers("/api/recently-viewed/**", "/api/dislikes/**").authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/health/live", "/api/health/ready", "/api/health/ai", "/api/ai/status", "/api/platform/config", "/api/platform/image-access", "/api/collections/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/platform/contact", "/api/platform/newsletter", "/api/platform/newsletter/confirm", "/api/platform/newsletter/unsubscribe").permitAll()
                        .requestMatchers("/api/platform/admin/**").hasAuthority("ROLE_ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/ai/search", "/api/ai/vision", "/api/ai/requests/*/cancel").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/public/cook/recipes/*/ask", "/api/public/cook/recipes/*/speak", "/api/public/cook/recipes/*/timer-cue", "/api/public/cook/recipes/*/transcribe").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/meal-plans/generate", "/api/meal-plans/recalculate", "/api/meal-plans/what-if").permitAll()
                        .requestMatchers(HttpMethod.GET,
                                "/", "/api/public/**", "/api/recipes/**", "/api/ingredients/**",
                                "/api/categories/**", "/api/cuisines/**", "/api/dietary-preferences/**")
                            .permitAll()
                        .requestMatchers(
                                "/api/auth/**",
                                "/api/opencv/**"
                        ).permitAll()
                        .anyRequest().authenticated()
                )
                .oauth2ResourceServer(rs -> rs.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())))
                .addFilterAfter(new AIRequestControlFilter(controls),org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter.class)
                .build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            List<GrantedAuthority> authorities = new ArrayList<>(scopes.convert(jwt));
            // Supabase user_metadata is editable by the user; only app_metadata is trusted.
            Map<String, Object> metadata = jwt.getClaimAsMap("app_metadata");
            if (metadata != null && "admin".equals(metadata.get("role"))) {
                authorities.add(new SimpleGrantedAuthority("ROLE_ADMIN"));
            }
            return authorities;
        });
        return converter;
    }

    @Bean
    public JwtDecoder jwtDecoder(
            @Value("${supabase.jwt.secret}") String secret,
            @Value("${supabase.jwt.issuer}") String issuer,
            @Value("${supabase.jwt.jwk-set-uri}") String jwkSetUri,
            @Value("${supabase.jwt.audience}") String audience) {
        NimbusJwtDecoder decoder;
        if (!secret.isBlank()) {
            decoder = NimbusJwtDecoder.withSecretKey(
                    new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
                    .macAlgorithm(MacAlgorithm.HS256).build();
        } else {
            decoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri)
                    .jwsAlgorithm(SignatureAlgorithm.ES256)
                    .jwsAlgorithm(SignatureAlgorithm.RS256).build();
        }
        OAuth2TokenValidator<Jwt> audienceValidator = jwt -> jwt.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error(
                        "invalid_token", "Token audience is not a Supabase user session", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer), audienceValidator));
        return decoder;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors-origins}") String origins) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(Arrays.stream(origins.split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
