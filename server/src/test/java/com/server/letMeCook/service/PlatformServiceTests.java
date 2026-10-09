package com.server.letMeCook.service;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
class PlatformServiceTests {
 Jwt jwt(Map<String,Object> app,Map<String,Object> editable){return Jwt.withTokenValue("test").header("alg","HS256").subject(UUID.randomUUID().toString()).claim("app_metadata",app).claim("user_metadata",editable).build();}
 PlatformService service(JdbcTemplate jdbc){return new PlatformService(jdbc,new ObjectMapper(),"127.0.0.1",56425,"http://localhost:9401");}
 @Test void editableRoleCannotGrantAdministrator(){assertThrows(ResponseStatusException.class,()->PlatformService.admin(jwt(Map.of(),Map.of("role","admin"))));assertDoesNotThrow(()->PlatformService.admin(jwt(Map.of("role","admin"),Map.of())));}
 @Test void subscriptionNeedsExplicitConsentBeforeDatabaseWrite(){JdbcTemplate jdbc=mock(JdbcTemplate.class);assertThrows(ResponseStatusException.class,()->service(jdbc).subscribe(Map.of("email","test@example.test","consent",false),"127.0.0.1"));verifyNoInteractions(jdbc);}
 @Test void boundedContactAndEmailRejectBeforeWrite(){JdbcTemplate jdbc=mock(JdbcTemplate.class);assertThrows(ResponseStatusException.class,()->service(jdbc).contact(Map.of("name","Test","email","bad","message","hello"),"a"));assertThrows(ResponseStatusException.class,()->service(jdbc).contact(Map.of("name","Test","email","test@example.test","message","x".repeat(5001)),"b"));verifyNoInteractions(jdbc);}
 @Test void malformedConfirmationCannotReachDatabase(){JdbcTemplate jdbc=mock(JdbcTemplate.class);assertThrows(ResponseStatusException.class,()->service(jdbc).newsletterToken("malformed",false));verifyNoInteractions(jdbc);}
 @Test void publicSubmissionRateIsBounded(){var service=service(mock(JdbcTemplate.class));for(int i=0;i<8;i++)service.limit("same-client");assertEquals(429,assertThrows(ResponseStatusException.class,()->service.limit("same-client")).getStatusCode().value());assertDoesNotThrow(()->service.limit("another-client"));}
 @Test void collaborationIsIndependentAndMissingOrMalformedFlagsFailClosed(){JdbcTemplate jdbc=mock(JdbcTemplate.class);when(jdbc.queryForObject(anyString(),eq(String.class))).thenReturn("{\"kitchenEnabled\":true,\"voiceEnabled\":true}","{\"collaborationEnabled\":\"true\"}","{\"collaborationEnabled\":true}");PlatformService service=service(jdbc);assertFalse(service.collaborationEnabled());assertFalse(service.collaborationEnabled());assertTrue(service.collaborationEnabled());}
 @Test void settingsRequireExplicitBooleanCollaborationChoiceBeforeWriting(){JdbcTemplate jdbc=mock(JdbcTemplate.class);PlatformService service=service(jdbc);Jwt admin=jwt(Map.of("role","admin"),Map.of());Map<String,Object> settings=new LinkedHashMap<>(Map.of("publicDemo",false,"kitchenEnabled",true,"voiceEnabled",true));assertThrows(ResponseStatusException.class,()->service.settings(settings,admin));settings.put("collaborationEnabled","true");assertThrows(ResponseStatusException.class,()->service.settings(settings,admin));verifyNoInteractions(jdbc);settings.put("collaborationEnabled",false);assertEquals(false,service.settings(settings,admin).get("collaborationEnabled"));verify(jdbc).update(anyString(),anyString());}
}
