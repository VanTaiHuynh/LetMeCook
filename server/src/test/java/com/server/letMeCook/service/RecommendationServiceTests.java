package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.config.RecommendationProperties;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

class RecommendationServiceTests {
    private RecommendationService service(RestTemplate rest) {
        var properties = new RecommendationProperties();
        properties.setUrl("http://127.0.0.1:9501");
        return new RecommendationService(rest, properties);
    }

    @Test
    void postCarriesCompleteEligibilityInBodyAndPreservesRankWithoutIdentity() throws Exception {
        var rest = new RestTemplate();
        var server = MockRestServiceServer.bindTo(rest).build();
        UUID seed = UUID.randomUUID(), disliked = UUID.randomUUID();
        List<UUID> eligible = java.util.stream.IntStream.range(0, 150).mapToObj(i -> UUID.randomUUID()).toList();
        UUID distantWinner = eligible.getLast(), next = eligible.getFirst();
        String expected = new ObjectMapper().writeValueAsString(Map.of("favorites", List.of(seed), "history", List.of(),
                "eligibleIds", eligible, "excludedIds", Set.of(disliked), "dietaryPreferences", List.of("vegetarian"), "topK", 100));
        server.expect(requestTo("http://127.0.0.1:9501/recommend/user"))
                .andExpect(method(HttpMethod.POST)).andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(content().json(expected, true))
                .andRespond(withSuccess(new ObjectMapper().writeValueAsString(Map.of("recommendations",
                        List.of(List.of(distantWinner, .9), List.of(next, .8)))), MediaType.APPLICATION_JSON));
        assertEquals(List.of(distantWinner, next), service(rest).recommendForUser(List.of(seed), List.of(), eligible,
                Set.of(disliked), Set.of("vegetarian"), 100));
        server.verify();
    }

    @Test
    void workerCannotAddIneligibleOrExcludedRecipesAndDuplicateRanks() throws Exception {
        var rest = new RestTemplate();
        var server = MockRestServiceServer.bindTo(rest).build();
        UUID allowed = UUID.randomUUID(), excluded = UUID.randomUUID(), unknown = UUID.randomUUID();
        server.expect(requestTo("http://127.0.0.1:9501/recommend/user"))
                .andRespond(withSuccess(new ObjectMapper().writeValueAsString(Map.of("recommendations",
                        List.of(List.of(unknown, .99), List.of(excluded, .95), List.of(allowed, .9), List.of(allowed, .8)))), MediaType.APPLICATION_JSON));
        assertEquals(List.of(allowed), service(rest).recommendForUser(List.of(), List.of(), List.of(allowed, excluded),
                Set.of(excluded), Set.of(), 10));
        server.verify();
    }

    @Test
    void unavailableOrMalformedWorkerIsNotReportedAsASuccessfulEmptyRanking() {
        for (boolean unavailable : List.of(true, false)) {
            var rest = new RestTemplate();
            var server = MockRestServiceServer.bindTo(rest).build();
            server.expect(requestTo("http://127.0.0.1:9501/recommend/user"))
                    .andRespond(unavailable ? withServerError() : withSuccess("{\"recommendations\":[[\"invalid-uuid\",0.8]]}", MediaType.APPLICATION_JSON));
            assertEquals(unavailable?HttpStatus.INTERNAL_SERVER_ERROR:HttpStatus.BAD_GATEWAY,
                    assertThrows(ResponseStatusException.class,()->service(rest).recommendForUser(List.of(), List.of(), List.of(UUID.randomUUID()), Set.of(), Set.of(), 10)).getStatusCode());
            server.verify();
        }
    }
}
