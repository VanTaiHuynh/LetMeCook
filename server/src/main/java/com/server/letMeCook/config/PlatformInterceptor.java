package com.server.letMeCook.config;
import com.server.letMeCook.service.PlatformService;
import jakarta.servlet.http.*;
import java.util.Map;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
@Configuration
public class PlatformInterceptor implements WebMvcConfigurer,HandlerInterceptor {
 private final PlatformService platform;
 public PlatformInterceptor(PlatformService platform){this.platform=platform;}
 @Override public void addInterceptors(InterceptorRegistry registry){registry.addInterceptor(this).addPathPatterns("/api/**");}
 @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler){
  String path=request.getRequestURI();
  if(path.startsWith("/api/kitchen")){Map<String,Object> flags=platform.config();if(!Boolean.TRUE.equals(flags.get("kitchenEnabled")))throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Kitchen features are disabled by the administrator.");if(path.contains("/voice/")&&!Boolean.TRUE.equals(flags.get("voiceEnabled")))throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Local voice is disabled by the administrator.");}return true;
 }
 @Override public void afterCompletion(HttpServletRequest request,HttpServletResponse response,Object handler,Exception error){
  var authentication=SecurityContextHolder.getContext().getAuthentication();
  if(authentication!=null&&authentication.getPrincipal() instanceof Jwt jwt){var metadata=jwt.getClaimAsMap("app_metadata");if(metadata!=null&&"admin".equals(metadata.get("role"))&&!request.getMethod().equals("OPTIONS"))platform.audit(java.util.UUID.fromString(jwt.getSubject()),request.getMethod(),request.getRequestURI(),response.getStatus());}
 }
}
