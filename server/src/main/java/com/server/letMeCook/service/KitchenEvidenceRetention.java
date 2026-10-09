package com.server.letMeCook.service;

import com.server.letMeCook.repository.KitchenRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** Only consented analytics events are eligible; operational kitchen data is never purged here. */
@Configuration
@EnableScheduling
public class KitchenEvidenceRetention {
    private static final Logger log=LoggerFactory.getLogger(KitchenEvidenceRetention.class);
    private final KitchenRepository repository;
    private final Clock clock;
    private final boolean enabled;
    private final int batchSize,maxBatches;

    @Autowired
    public KitchenEvidenceRetention(KitchenRepository repository,
        @Value("${kitchen.evidence-retention.enabled:true}") boolean enabled,
        @Value("${kitchen.evidence-retention.batch-size:500}") int batchSize,
        @Value("${kitchen.evidence-retention.max-batches:4}") int maxBatches) {
        this(repository,Clock.systemUTC(),enabled,batchSize,maxBatches);
    }
    KitchenEvidenceRetention(KitchenRepository repository,Clock clock,boolean enabled,int batchSize,int maxBatches) {
        if(batchSize<1||batchSize>1000||maxBatches<1||maxBatches>10)throw new IllegalArgumentException("Invalid evidence retention batch bounds");
        this.repository=repository;this.clock=clock;this.enabled=enabled;this.batchSize=batchSize;this.maxBatches=maxBatches;
    }
    @Scheduled(fixedDelayString="${kitchen.evidence-retention.interval-ms:3600000}",initialDelayString="${kitchen.evidence-retention.initial-delay-ms:30000}")
    public void scheduledPurge() {
        try {
            int removed=purge();
            if(removed>0)log.info("Kitchen evidence retention removed {} expired analytics records",removed);
        } catch(RuntimeException failure) {
            // Avoid identifiers, event contents or SQL parameters in maintenance logs.
            log.warn("Kitchen evidence retention could not finish; the next scheduled run will retry");
        }
    }
    int purge() {
        if(!enabled)return 0;
        Instant now=clock.instant(),cutoff=now.minus(Duration.ofDays(90));int removed=0;
        for(int batch=0;batch<maxBatches;batch++) {
            int count=repository.purgeEvidence(cutoff,batchSize);removed+=count;
            if(count<batchSize)break;
        }
        for(int batch=0;batch<maxBatches;batch++) {
            int count=repository.purgeCohorts(now,batchSize);removed+=count;
            if(count<batchSize)break;
        }
        return removed;
    }
}
