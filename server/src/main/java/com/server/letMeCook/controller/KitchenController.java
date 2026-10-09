package com.server.letMeCook.controller;

import com.server.letMeCook.service.KitchenService;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

/** All routes use the existing authenticated default security rule. */
@RestController
@RequestMapping("/api/kitchen")
public class KitchenController {
    @PostMapping("/sessions/{id}/speak") public Map<String,Object> speakStep(@PathVariable UUID id,@RequestParam(required=false)UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.speakStep(householdId,id,body,jwt);}
    private final KitchenService service;
    public KitchenController(KitchenService service){this.service=service;}
    @GetMapping("/bootstrap") public Map<String,Object> bootstrap(@RequestParam(required=false) UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.bootstrap(householdId,jwt);}
    @PostMapping("/households") public Map<String,Object> createHousehold(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.createHousehold(body,jwt);}
    @GetMapping("/households/{id}/members") public Map<String,Object> members(@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.members(id,jwt);}
    @PostMapping("/households/{id}/invites") public Map<String,Object> invite(@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.invite(id,body,jwt);}
    @PostMapping("/invites/accept") public Map<String,Object> accept(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.acceptInvite(body,jwt);}
    @PatchMapping("/households/{id}/members/{userId}") public Map<String,Object> role(@PathVariable UUID id,@PathVariable UUID userId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.changeRole(id,userId,body,jwt);}
    @PostMapping("/pantry") public Map<String,Object> addLot(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.savePantry(selectedScope(householdId,body),null,body,jwt);}
    @PatchMapping("/pantry/{id}") public Map<String,Object> updateLot(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.savePantry(selectedScope(householdId,body),id,body,jwt);}
    @DeleteMapping("/pantry/{id}") public Map<String,Object> removeLot(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@RequestParam long version,@AuthenticationPrincipal Jwt jwt){return service.deletePantry(householdId,id,version,jwt);}
    @GetMapping("/ledger") public Map<String,Object> ledger(@RequestParam(required=false) UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.ledger(householdId,jwt);}
    @PostMapping("/prices") public Map<String,Object> price(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.savePrice(selectedScope(householdId,body),body,jwt);}
    @DeleteMapping("/prices/{id}") public Map<String,Object> removePrice(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.deleteRecord(householdId,id,"price",false,jwt);}
    @GetMapping("/shopping") public Map<String,Object> shopping(@RequestParam(required=false) UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.shopping(householdId,jwt);}
    @PutMapping("/shopping") public Map<String,Object> saveShopping(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.saveShopping(selectedScope(householdId,body),body,jwt);}
    @PostMapping("/sessions") public Map<String,Object> start(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.startSession(selectedScope(householdId,body),body,jwt);}
    @GetMapping("/sessions/{id}") public Map<String,Object> session(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.session(householdId,id,jwt);}
    @PatchMapping("/sessions/{id}") public Map<String,Object> updateSession(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.updateSession(selectedScope(householdId,body),id,body,jwt);}
    @PostMapping("/sessions/{id}/ask") public Map<String,Object> ask(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.ask(selectedScope(householdId,body),id,body,jwt);}
    @PostMapping("/sessions/{id}/complete") public Map<String,Object> complete(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.complete(selectedScope(householdId,body),id,body,jwt);}
    @PostMapping("/consent") public Map<String,Object> consent(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.consent(body,jwt);}
    @GetMapping("/evidence") public Map<String,Object> evidence(@RequestParam(required=false) UUID householdId,@RequestParam(required=false) String cohortName,@AuthenticationPrincipal Jwt jwt){return service.evidence(householdId,cohortName,jwt);}
    @PostMapping("/cohorts/enroll") public Map<String,Object> enroll(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.enrollCohort(selectedScope(householdId,body),body,jwt);}
    @PostMapping("/cohorts/{id}/withdraw") public Map<String,Object> withdraw(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.withdrawCohort(selectedScope(householdId,body),id,body,jwt);}
    @GetMapping("/evidence/export") public Map<String,Object> exportEvidence(@AuthenticationPrincipal Jwt jwt){return service.exportEvidence(jwt);}
    @DeleteMapping("/evidence") public Map<String,Object> deleteEvidence(@AuthenticationPrincipal Jwt jwt){return service.deleteEvidence(jwt);}
    @PostMapping("/substitutions") public Map<String,Object> swap(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.saveSwap(selectedScope(householdId,body),body,jwt);}
    @PostMapping("/substitutions/preview") public Map<String,Object> previewSwap(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.previewSwap(selectedScope(householdId,body),body,jwt);}
    @DeleteMapping("/substitutions/{id}") public Map<String,Object> removeSwap(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.deleteRecord(householdId,id,"swap",false,jwt);}
    @PostMapping("/workspace") public Map<String,Object> workspace(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.saveWorkspace(selectedScope(householdId,body),body,jwt);}
    @PostMapping("/workspace/catalog") public Map<String,Object> addCatalog(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.addCatalog(selectedScope(householdId,body),body,jwt);}
    @GetMapping("/workspace/catalog") public Map<String,Object> catalog(@RequestParam(required=false) UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.catalog(householdId,jwt);}
    @DeleteMapping("/workspace/catalog/{id}") public Map<String,Object> removeCatalog(@RequestParam(required=false) UUID householdId,@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.deleteRecord(householdId,id,"catalog",true,jwt);}
    @PostMapping("/coverage") public Map<String,Object> coverage(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.coverage(selectedScope(householdId,body),body,jwt);}
    @PostMapping("/suggestions") public Map<String,Object> suggestions(@RequestParam(required=false) UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.suggestions(selectedScope(householdId,body),body,jwt);}
    @PostMapping("/voice/transcribe") public Map<String,Object> transcribe(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.transcribe(body,jwt);}
    @PostMapping("/voice/speak") public Map<String,Object> speak(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.speak(body,jwt);}
    private static UUID selectedScope(UUID query,Map<String,Object> body){
        Object raw=body.get("householdId");if(raw==null)return query;
        try{
            if(!(raw instanceof String value))throw new IllegalArgumentException();
            UUID requested=UUID.fromString(value);
            if(!requested.toString().equalsIgnoreCase(value)||query!=null&&!query.equals(requested))throw new IllegalArgumentException();
            return requested;
        }catch(IllegalArgumentException error){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Use one valid householdId in the query or request body.");}
    }
}
