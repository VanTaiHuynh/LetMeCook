package com.server.letMeCook.service;

import com.server.letMeCook.config.RecommendationProperties;
import com.server.letMeCook.controller.RecommendationController;
import com.server.letMeCook.controller.RecipeController;
import java.net.SocketTimeoutException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

class RecommendationGatewayTests {
    @Test void realTasteFeedbackIsForwardedAsSoftSignalsWithoutAccountIdentity(){
        UUID recipe=UUID.randomUUID();worker.expect(requestTo(origin+"/recommend/user")).andExpect(method(HttpMethod.POST))
            .andExpect(content().json("{\"contractVersion\":\"local-ai.v2\",\"tasteFeedback\":[{\"recipeId\":\""+recipe+"\",\"rating\":2}],\"tasteSignals\":{\"avoidedIngredients\":[\"mushroom\"]}}",false))
            .andRespond(withSuccess("{\"recommendations\":[],\"count\":0}",MediaType.APPLICATION_JSON));
        assertTrue(service().recommendForUser(List.of(),List.of(),List.of(recipe),Set.of(),List.of(),10,Map.of("tasteFeedback",List.of(Map.of("recipeId",recipe.toString(),"rating",2)),"tasteSignals",Map.of("avoidedIngredients",List.of("mushroom")),"userId","never-forwarded")).isEmpty());worker.verify();
    }
    final String origin="http://127.0.0.1:9501";
    final RestTemplate rest=new RestTemplate();
    final MockRestServiceServer worker=MockRestServiceServer.bindTo(rest).build();
    RecommendationService service(){var settings=new RecommendationProperties();settings.setUrl(origin);return new RecommendationService(rest,settings);}
    final String pipeline="{\"started\":true,\"message\":\"queued\",\"pipeline\":{\"status\":\"queued\"}}";

    @Test void legacyAndCanonicalPipelineRoutesUseTheSameWorkerPostAndPreserveAcceptedStatus() throws Exception {
        var mvc=MockMvcBuilders.standaloneSetup(new RecommendationController(service())).build();
        for(int i=0;i<3;i++)
            worker.expect(requestTo(origin+"/pipeline/run")).andExpect(method(HttpMethod.POST)).andRespond(withStatus(HttpStatus.ACCEPTED).contentType(MediaType.APPLICATION_JSON).body(pipeline));
        for(String path:List.of("/embed/update","/pipeline/run")){
            mvc.perform(post("/api/recipes/recommendation"+path)).andExpect(status().isAccepted()).andExpect(jsonPath("$.pipeline.status").value("queued"));
        }
        mvc.perform(get("/api/recipes/recommendation/pipeline/run")).andExpect(status().isAccepted());worker.verify();
    }

    @Test void legacyRecipeUpdateAdapterUsesCanonicalPipelineAndDoesNotInventSuccess() throws Exception {
        var controller=new RecipeController(mock(RecipeService.class));ReflectionTestUtils.setField(controller,"recommendationService",service());
        var mvc=MockMvcBuilders.standaloneSetup(controller).build();
        worker.expect(requestTo(origin+"/pipeline/run")).andExpect(method(HttpMethod.POST)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).contentType(MediaType.APPLICATION_JSON).body("{\"details\":\"internal-secret\"}"));
        mvc.perform(get("/api/recipes/flask-update-embed")).andExpect(status().isServiceUnavailable());worker.verify();
    }

    @Test void statusAliasesUseTheCanonicalGetContract() throws Exception {
        var mvc=MockMvcBuilders.standaloneSetup(new RecommendationController(service())).build();
        for(int i=0;i<2;i++)
            worker.expect(requestTo(origin+"/pipeline/status")).andExpect(method(HttpMethod.GET)).andRespond(withSuccess("{\"status\":\"running\",\"pipeline\":{\"status\":\"running\"}}",MediaType.APPLICATION_JSON));
        for(String path:List.of("/embed/status","/pipeline/status")){
            mvc.perform(get("/api/recipes/recommendation"+path)).andExpect(status().isOk()).andExpect(jsonPath("$.pipeline.status").value("running"));
        }
        worker.verify();
    }

    @Test void busyAndDependencyFailuresReachClientsWithoutRawWorkerDetails() throws Exception {
        var mvc=MockMvcBuilders.standaloneSetup(new RecommendationController(service())).build();
        worker.expect(requestTo(origin+"/pipeline/run")).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS).contentType(MediaType.APPLICATION_JSON).body("{\"message\":\"internal-token private-profile\"}"));
        worker.expect(requestTo(origin+"/cache/info")).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).body("internal-password"));
        mvc.perform(post("/api/recipes/recommendation/pipeline/run")).andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","10"));
        ResponseStatusException failure=assertThrows(ResponseStatusException.class,()->service().getCacheInfo());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,failure.getStatusCode());assertFalse(failure.getReason().contains("internal-password"));worker.verify();
    }

    @Test void aTimeoutIsServiceUnavailableAndMalformedSuccessIsBadGateway() {
        worker.expect(requestTo(origin+"/cache/info")).andRespond(request->{throw new SocketTimeoutException("private connection details");});
        worker.expect(requestTo(origin+"/pipeline/run")).andRespond(withStatus(HttpStatus.ACCEPTED).contentType(MediaType.APPLICATION_JSON).body("{\"message\":\"claimed success\"}"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,assertThrows(ResponseStatusException.class,()->service().getCacheInfo()).getStatusCode());
        assertEquals(HttpStatus.BAD_GATEWAY,assertThrows(ResponseStatusException.class,()->service().startPipeline()).getStatusCode());worker.verify();
    }

    @Test void embeddingMutationsValidateCanonicalIdsAndRejectUnknownFieldsBeforeHttp() throws Exception {
        var mvc=MockMvcBuilders.standaloneSetup(new RecommendationController(service())).build();
        for(String body:List.of("{}","{\"id\":\"not-a-uuid\"}","{\"id\":null}","{\"id\":\"1-1-1-1-1\"}","{\"id\":\"x\",\"profile\":{}}"))
            mvc.perform(post("/api/recipes/recommendation/embed/add").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        for(String body:List.of("{}","{\"ids\":[]}","{\"ids\":\"bad\"}","{\"ids\":[null]}","{\"ids\":[\"bad\"]}"))
            mvc.perform(post("/api/recipes/recommendation/embed/remove").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        worker.verify();
    }

    @Test void embeddingAddAndRemovePreserveWorkerReceiptsAndDeduplicateIds() {
        String id=UUID.randomUUID().toString();
        worker.expect(requestTo(origin+"/embedding/add")).andExpect(method(HttpMethod.POST)).andExpect(content().json("{\"id\":\""+id+"\"}"))
                .andRespond(withSuccess("{\"message\":\"added\",\"recipe_id\":\""+id+"\"}",MediaType.APPLICATION_JSON));
        worker.expect(requestTo(origin+"/embedding/remove")).andExpect(method(HttpMethod.POST)).andExpect(content().json("{\"ids\":[\""+id+"\"]}"))
                .andRespond(withSuccess("{\"message\":\"removed\",\"removed_ids\":[\""+id+"\"]}",MediaType.APPLICATION_JSON));
        assertEquals(id,service().addEmbedding(Map.of("id",id)).getBody().get("recipe_id"));
        assertEquals(List.of(id),service().removeEmbeddings(Map.of("ids",List.of(id,id))).getBody().get("removed_ids"));worker.verify();
    }

    @Test void aValidEmptyRankingRemainsSuccessfulButBusyAndMalformedRankingsDoNot() {
        List<UUID> eligible=List.of(UUID.randomUUID());
        worker.expect(requestTo(origin+"/recommend/user")).andRespond(withSuccess("{\"recommendations\":[],\"count\":0}",MediaType.APPLICATION_JSON));
        worker.expect(requestTo(origin+"/recommend/user")).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        worker.expect(requestTo(origin+"/recommend/user")).andRespond(withSuccess("<html>wrong response</html>",MediaType.TEXT_HTML));
        assertEquals(List.of(),service().recommendForUser(List.of(),List.of(),eligible,Set.of(),Set.of(),10));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS,assertThrows(ResponseStatusException.class,()->service().recommendForUser(List.of(),List.of(),eligible,Set.of(),Set.of(),10)).getStatusCode());
        assertEquals(HttpStatus.BAD_GATEWAY,assertThrows(ResponseStatusException.class,()->service().recommendForUser(List.of(),List.of(),eligible,Set.of(),Set.of(),10)).getStatusCode());worker.verify();
    }

    @Test void invalidRankingBoundsFailWithoutTruncatingEligibilityOrCallingWorker() {
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service().recommendForUser(List.of(),List.of(),Collections.nCopies(20001,UUID.randomUUID()),Set.of(),Set.of(),10)).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service().recommendByRecipeId(UUID.randomUUID(),0)).getStatusCode());worker.verify();
    }
}
