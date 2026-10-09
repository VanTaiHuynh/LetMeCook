package com.server.letMeCook.service;

import com.server.letMeCook.repository.KitchenRepository;
import java.time.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class KitchenEvidenceRetentionTests {
    final Instant now=Instant.parse("2026-10-08T12:00:00Z"),cutoff=now.minus(Duration.ofDays(90));
    final Clock clock=Clock.fixed(now,ZoneOffset.UTC);
    @Test void disabledMaintenanceDoesNotTouchAnyData(){
        KitchenRepository repository=mock(KitchenRepository.class);
        assertEquals(0,new KitchenEvidenceRetention(repository,clock,false,500,4).purge());verifyNoInteractions(repository);
    }
    @Test void usesExactNinetyDayCutoffAndStopsAfterPartialBatch(){
        KitchenRepository repository=mock(KitchenRepository.class);when(repository.purgeEvidence(cutoff,2)).thenReturn(2,1);
        assertEquals(3,new KitchenEvidenceRetention(repository,clock,true,2,4).purge());verify(repository,times(2)).purgeEvidence(cutoff,2);
        verify(repository,never()).delete(any(),any(),anyString(),anyLong());
    }
    @Test void fullBacklogCannotExceedConfiguredBoundPerRun(){
        KitchenRepository repository=mock(KitchenRepository.class);when(repository.purgeEvidence(cutoff,500)).thenReturn(500);
        assertEquals(2000,new KitchenEvidenceRetention(repository,clock,true,500,4).purge());verify(repository,times(4)).purgeEvidence(cutoff,500);
        assertThrows(IllegalArgumentException.class,()->new KitchenEvidenceRetention(repository,clock,true,1001,4));
        assertThrows(IllegalArgumentException.class,()->new KitchenEvidenceRetention(repository,clock,true,500,11));
    }
    @Test void enrollmentMetadataUsesOriginalNinetyDayExpiryAndIndependentBoundedBatches(){
        KitchenRepository repository=mock(KitchenRepository.class);when(repository.purgeEvidence(cutoff,2)).thenReturn(2,1);when(repository.purgeCohorts(now,2)).thenReturn(2,2,2);
        assertEquals(9,new KitchenEvidenceRetention(repository,clock,true,2,3).purge());verify(repository,times(2)).purgeEvidence(cutoff,2);verify(repository,times(3)).purgeCohorts(now,2);
        verifyNoMoreInteractions(repository);
    }
}
