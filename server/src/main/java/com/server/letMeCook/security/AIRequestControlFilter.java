package com.server.letMeCook.security;
import com.server.letMeCook.service.AIRequestRegistry;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.filter.OncePerRequestFilter;

public final class AIRequestControlFilter extends OncePerRequestFilter {
    private final AIRequestRegistry registry;private final SecureRandom random=new SecureRandom();
    public AIRequestControlFilter(AIRequestRegistry registry){this.registry=registry;}
    @Override protected boolean shouldNotFilter(HttpServletRequest request){return request.getRequestURI().endsWith("/cancel")||(!"POST".equals(request.getMethod())&&request.getHeader("X-Local-AI-Request-Id")==null&&request.getHeader("X-Local-AI-Timeout-Ms")==null);}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
        String timeout=request.getHeader("X-Local-AI-Timeout-Ms"),id=request.getHeader("X-Local-AI-Request-Id"),token=request.getHeader("X-Local-AI-Cancel-Token");
        int milliseconds=150000;UUID requestId;
        try{
            if(timeout!=null){if(!timeout.matches("[0-9]{4,6}"))throw new IllegalArgumentException();milliseconds=Integer.parseInt(timeout);if(milliseconds<1000||milliseconds>180000)throw new IllegalArgumentException();}
            requestId=id==null?UUID.randomUUID():UUID.fromString(id);if(id!=null&&!requestId.toString().equalsIgnoreCase(id))throw new IllegalArgumentException();
            if(token!=null&&(id==null||!token.matches("[A-Za-z0-9_-]{32,128}")))throw new IllegalArgumentException();
        }catch(IllegalArgumentException e){response.setStatus(400);response.setContentType("application/json");response.getWriter().write("{\"message\":\"Choose valid local AI timeout and request controls.\"}");return;}
        if(token==null){byte[] bytes=new byte[32];random.nextBytes(bytes);token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
        var auth=SecurityContextHolder.getContext().getAuthentication();UUID actor=auth!=null&&auth.getPrincipal() instanceof Jwt jwt?RequestIdentity.optionalUserId(jwt):null;
        var control=new AIRequestContext.Control(requestId,actor,token,milliseconds);AIRequestContext.set(control);response.setHeader("X-Local-AI-Request-Id",requestId.toString());
        try{chain.doFilter(request,response);}finally{registry.finish(control);AIRequestContext.clear();}
    }
}
