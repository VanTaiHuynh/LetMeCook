package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class ReadinessService {
    private static final String SCHEMA_CHECK = """
        SELECT NOT EXISTS (
          SELECT 1 FROM unnest(ARRAY['public.recipe','public.recipe_ingredients','public.users',
            'public.reviews','public.review_ratings','public.kitchen_scopes','public.kitchen_members',
            'public.kitchen_records','public.weekly_meal_plans','public.lmc_platform_settings']) AS t(name)
          WHERE to_regclass(t.name) IS NULL
        ) AND to_regprocedure('public.save_recipe(jsonb)') IS NOT NULL
          AND to_regprocedure('public.lmc_recipe_demo_visible(boolean,text,text,text)') IS NOT NULL
        """;
    private static final Set<String> CAPABILITIES = Set.of("recommendation", "catalog", "text", "vision", "voice", "speech");
    private final DataSource source;
    private final String workerUrl;
    private final ObjectMapper mapper;
    private final long waitMillis;
    private final Semaphore admission = new Semaphore(1);
    private final ExecutorService executor = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "letmecook-readiness");
        thread.setDaemon(true);
        return thread;
    });

    public record Result(boolean ready, Map<String, String> checks) {}

    @Autowired
    public ReadinessService(DataSource source, @Value("${local-ai.url}") String workerUrl, ObjectMapper mapper) {
        this(source, workerUrl, mapper, 3000);
    }

    ReadinessService(DataSource source, String workerUrl, ObjectMapper mapper, long waitMillis) {
        this.source = source;
        this.workerUrl = workerUrl;
        this.mapper = mapper;
        this.waitMillis = waitMillis;
    }

    public Result database() {
        // At most one outstanding probe can borrow a connection. A slow pool
        // does not accumulate health tasks or block the HTTP caller indefinitely.
        if (!admission.tryAcquire()) return unavailable("database", "probe_busy");
        Future<Result> pending;
        try {
            pending = executor.submit(() -> {
                try (Connection connection = source.getConnection();
                     PreparedStatement statement = connection.prepareStatement(SCHEMA_CHECK)) {
                    statement.setQueryTimeout(2);
                    try (ResultSet rows = statement.executeQuery()) {
                        boolean schema = rows.next() && rows.getBoolean(1);
                        return new Result(schema, Map.of("database", "ready", "schema", schema ? "ready" : "missing"));
                    }
                } catch (Exception error) {
                    return unavailable("database", "unavailable");
                } finally {
                    admission.release();
                }
            });
        } catch (RuntimeException error) {
            admission.release();
            return unavailable("database", "unavailable");
        }
        try {
            return pending.get(waitMillis, TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return unavailable("database", "interrupted");
        } catch (Exception error) {
            // Keep admission until the underlying borrow/query finishes. Do not
            // queue another probe behind a JDBC operation that ignores interruption.
            return unavailable("database", "timeout");
        }
    }

    public Result ai(String capability) {
        if (!CAPABILITIES.contains(capability)) throw new IllegalArgumentException("Unknown AI capability.");
        HttpURLConnection connection = null;
        try {
            URI base = URI.create(workerUrl);
            if (!"http".equals(base.getScheme()) || !Set.of("localhost", "127.0.0.1", "::1").contains(base.getHost())
                    || base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null) {
                return unavailable(capability, "invalid_local_configuration");
            }
            connection = (HttpURLConnection) URI.create(workerUrl.replaceAll("/+$", "")
                    + "/health/ready?capability=" + capability).toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1000);
            connection.setReadTimeout(1000);
            connection.setRequestProperty("Accept", "application/json");
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            if (connection.getResponseCode() != 200) return unavailable(capability, "unavailable");
            try (var input = connection.getInputStream(); var bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 16384 || System.nanoTime() > deadline) {
                        return unavailable(capability, "invalid_response");
                    }
                    bytes.write(buffer, 0, count);
                }
                var body = mapper.readTree(bytes.toByteArray());
                boolean ready = "ready".equals(body.path("status").asText());
                return new Result(ready, Map.of(capability, ready ? "ready" : "unavailable"));
            }
        } catch (Exception error) {
            return unavailable(capability, "unavailable");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private Result unavailable(String component, String state) {
        return new Result(false, Map.of(component, state));
    }

    @PreDestroy
    public void close() { executor.shutdownNow(); }
}
