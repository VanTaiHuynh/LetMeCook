package com.server.letMeCook.service;

import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Short database snapshots and commits, with no transaction around worker HTTP. */
@Component
public class InferenceTransactions {
    private final TransactionTemplate snapshot;
    private final TransactionTemplate commit;
    private final TransactionTemplate outside;

    public InferenceTransactions(PlatformTransactionManager manager) {
        snapshot = new TransactionTemplate(manager);
        snapshot.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        snapshot.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        // A first personal-kitchen read creates its scope, so this cannot be read-only.
        commit = new TransactionTemplate(manager);
        commit.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        outside = new TransactionTemplate(manager);
        outside.setPropagationBehavior(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
    }

    public <T> T snapshot(Supplier<T> action) { return snapshot.execute(status -> action.get()); }
    public <T> T commit(Supplier<T> action) { return commit.execute(status -> action.get()); }
    public <T> T outside(Supplier<T> action) { return outside.execute(status -> action.get()); }
}
