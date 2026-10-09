package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class ReadinessServiceTests {
    @Test void verifiesRequiredSchemaAndClosesConnectionWithBoundedSql() throws Exception {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet rows = mock(ResultSet.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(rows);
        when(rows.next()).thenReturn(true);
        when(rows.getBoolean(1)).thenReturn(true);
        try (var probe = fixture(source, 1000)) {
            assertTrue(probe.database().ready());
            verify(statement).setQueryTimeout(2);
            verify(connection).close();
            verify(rows).close();
        }
    }

    @Test void listeningServerWithMissingSchemaIsNotReady() throws Exception {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet rows = mock(ResultSet.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(rows);
        when(rows.next()).thenReturn(true);
        when(rows.getBoolean(1)).thenReturn(false);
        try (var probe = fixture(source, 1000)) {
            var result = probe.database();
            assertFalse(result.ready());
            assertEquals("missing", result.checks().get("schema"));
        }
    }

    @Test void databaseFailureIsUnavailableWithoutLeakingConnectionDetails() throws Exception {
        DataSource source = mock(DataSource.class);
        when(source.getConnection()).thenThrow(new SQLException("secret connection details"));
        try (var probe = fixture(source, 1000)) {
            var result = probe.database();
            assertFalse(result.ready());
            assertFalse(result.toString().contains("secret"));
        }
    }

    @Test void exhaustedPoolProbeTimesOutAndFurtherProbesDoNotQueue() throws Exception {
        DataSource source = mock(DataSource.class);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(source.getConnection()).thenAnswer(invocation -> {
            entered.countDown();
            release.await(2, TimeUnit.SECONDS);
            throw new SQLException("disconnected");
        });
        try (var probe = fixture(source, 80)) {
            long start = System.nanoTime();
            assertEquals("timeout", probe.database().checks().get("database"));
            assertTrue(entered.await(1, TimeUnit.SECONDS));
            assertEquals("probe_busy", probe.database().checks().get("database"));
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 700);
            verify(source, times(1)).getConnection();
        } finally { release.countDown(); }
    }

    @Test void unknownAiCapabilityIsRejectedWithoutCallingWorker() {
        try (var probe = fixture(mock(DataSource.class), 1000)) {
            assertThrows(IllegalArgumentException.class, () -> probe.ai("private/path"));
        }
    }

    @Test void remoteHealthConfigurationDoesNotMakeExternalRequest() {
        ReadinessService probe = new ReadinessService(mock(DataSource.class), "https://example.com", new ObjectMapper(), 1000);
        try { assertEquals("invalid_local_configuration", probe.ai("text").checks().get("text")); }
        finally { probe.close(); }
    }

    private Probe fixture(DataSource source, long waitMillis) {
        return new Probe(source, waitMillis);
    }
    private static final class Probe extends ReadinessService implements AutoCloseable {
        Probe(DataSource source, long waitMillis) { super(source, "http://127.0.0.1:9501", new ObjectMapper(), waitMillis); }
    }
}
