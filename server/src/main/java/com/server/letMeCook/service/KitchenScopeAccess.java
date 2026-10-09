package com.server.letMeCook.service;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
/** Short-transaction authorization port shared by kitchen, planning, growth and publication. */
@Service
public class KitchenScopeAccess {
    public enum Access { READ, WRITE, OWNER_WRITE }
    private final KitchenRepository repository;private final PlatformService platform;
    public KitchenScopeAccess(KitchenRepository repository,PlatformService platform){this.repository=repository;this.platform=platform;}
    public Scope require(UUID actor,UUID household,Access mode){
        if(actor==null)throw error(HttpStatus.UNAUTHORIZED,"Sign in to use your kitchen.");
        if(!Boolean.TRUE.equals(platform.config().get("kitchenEnabled")))throw error(HttpStatus.SERVICE_UNAVAILABLE,"Kitchen features are currently disabled.");
        Scope scope=household==null?repository.personal(actor):current(actor,household);
        com.server.letMeCook.security.AIRequestContext.scope(scope.id());
        if(household!=null&&!"household".equals(scope.kind()))throw error(HttpStatus.FORBIDDEN,"Choose an accepted household.");
        if(mode!=Access.READ){repository.lock(scope.id());scope=current(actor,scope.id());if(mode==Access.OWNER_WRITE&&!"owner".equals(scope.role()))throw error(HttpStatus.FORBIDDEN,"Only this kitchen's owner can make this change.");if("viewer".equals(scope.role()))throw error(HttpStatus.FORBIDDEN,"Viewers cannot change this kitchen.");if("household".equals(scope.kind())&&!"owner".equals(scope.role())&&!platform.collaborationEnabled())throw error(HttpStatus.SERVICE_UNAVAILABLE,"Shared kitchen changes are currently disabled.");}
        return scope;
    }
    public Scope current(UUID actor,UUID scope){return repository.access(scope,actor).orElseThrow(()->error(HttpStatus.FORBIDDEN,"Your kitchen membership is no longer available."));}
    private static ResponseStatusException error(HttpStatus status,String message){return new ResponseStatusException(status,message);}
}
