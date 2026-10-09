package com.server.letMeCook.security;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.web.server.ResponseStatusException;

/** Request-local control metadata contains no prompt or profile data. */
public final class AIRequestContext {
    private static final ThreadLocal<Control> CURRENT=new ThreadLocal<>();
    private AIRequestContext(){}
    public static final class Control {
        public final UUID id,actor;public final String token;public final long expiresNanos;
        public UUID scope;public boolean registered;
        public Control(UUID id,UUID actor,String token,int timeoutMs){this.id=id;this.actor=actor;this.token=token;this.expiresNanos=System.nanoTime()+timeoutMs*1_000_000L;}
        public int remaining(){long ms=(expiresNanos-System.nanoTime())/1_000_000;if(ms<1)throw failure(504,"The local AI request reached its time limit.");return (int)Math.min(ms,180000);}
        public void headers(HttpHeaders headers){int remaining=remaining();headers.set("X-Local-AI-Request-Id",id.toString());headers.set("X-Local-AI-Cancel-Token",token);headers.set("X-Local-AI-Timeout-Ms",Integer.toString(Math.max(1000,remaining)));}
    }
    public static Control current(){return CURRENT.get();}
    public static void set(Control control){CURRENT.set(control);}
    public static void clear(){CURRENT.remove();}
    public static void scope(UUID id){Control current=CURRENT.get();if(current!=null){if(current.scope!=null&&!current.scope.equals(id))throw failure(409,"An AI request cannot switch kitchens while running.");current.scope=id;}}
    public static ResponseStatusException failure(int code,String message){return new ResponseStatusException(HttpStatusCode.valueOf(code),message);}
}
