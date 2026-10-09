package com.server.letMeCook.service;

import java.util.Map;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

class LocalAIServiceTests {
    @Test void boundedClarificationCarriesTheOriginalSignedContextWithoutProfileIdentity(){
        RestTemplate client=new RestTemplate();var server=MockRestServiceServer.bindTo(client).build();var service=new LocalAIService(client,"http://localhost:9501");
        server.expect(requestTo("http://localhost:9501/ai/search")).andExpect(content().json("{\"prompt\":\"nut free dinner\",\"confirmedIngredients\":[],\"clarificationContext\":{\"signature\":\"unit-signed-envelope\"},\"clarificationAnswers\":{\"nut-type\":\"all nuts\"}}"))
            .andRespond(withSuccess("{\"status\":\"results\",\"recipes\":[]}",MediaType.APPLICATION_JSON));
        assertEquals("results",service.search(Map.of("prompt","nut free dinner","userId","must-not-forward","clarificationContext",Map.of("signature","unit-signed-envelope"),"clarificationAnswers",Map.of("nut-type","all nuts"))).get("status"));server.verify();
        assertThrows(ResponseStatusException.class,()->service.search(Map.of("clarificationAnswers",Map.of("question","answer"))));
        assertThrows(ResponseStatusException.class,()->service.search(Map.of("clarificationContext",Map.of(),"clarificationAnswers",Map.of("question","x".repeat(201)))));
    }
    @Test void refusesExternalModelsOrEmbeddedCredentials() {
        for (String url : List.of("https://api.openai.com", "http://example.com", "http://user:pass@localhost:9501", "http://localhost:9501/path")) {
            assertThrows(IllegalArgumentException.class, () -> new LocalAIService(new RestTemplate(), url));
        }
    }
    @Test void validatesBeforeCallingTheWorker() {
        LocalAIService service = new LocalAIService(new RestTemplate(), "http://localhost:9501");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
            () -> service.search(Map.of("prompt", "x".repeat(2001)))).getStatusCode());
        assertThrows(ResponseStatusException.class, () -> service.search(Map.of("confirmedIngredients", List.of(42))));
        assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, assertThrows(ResponseStatusException.class,
            () -> service.vision("a".repeat(7_000_001))).getStatusCode());
    }
    @Test void preservesActionableWorkerErrorWithoutReplacingItWithFakeSuccess() {
        RestTemplate client = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(client).build();
        server.expect(requestTo("http://localhost:9501/ai/search"))
            .andExpect(content().json("{\"prompt\":\"chicken\",\"confirmedIngredients\":[]}"))
            .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS).contentType(MediaType.APPLICATION_JSON)
                .body("{\"message\":\"Local AI is busy. Retry shortly.\"}"));
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> new LocalAIService(client, "http://localhost:9501").search(Map.of("prompt", "chicken")));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, error.getStatusCode());
        assertTrue(error.getReason().contains("busy"));
        server.verify();
    }
    @Test void legacyIntentCompatibilityIncludesTimeAndExclusions() {
        RestTemplate client = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(client).build();
        server.expect(requestTo("http://localhost:9501/ai/parse"))
            .andRespond(withSuccess("{\"keyword\":\"\",\"ingredients\":[\"chicken\"],\"allergies\":[\"peanut\"],\"cuisines\":[],\"categories\":[],\"dietaryPreferences\":[],\"maxCookingTime\":30}", MediaType.APPLICATION_JSON));
        var intent = new LocalAIService(client, "http://localhost:9501").extractRecipeSearchFields("gà không đậu phộng trong 30 phút");
        assertTrue(intent.getAllergies().contains("peanut"));
        assertEquals(30, intent.getMaxCookingTime());
        server.verify();
    }
}
