package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import static org.junit.jupiter.api.Assertions.*;

/** Real pooled connections matching deployment's auto-commit=false setting. */
@SpringJUnitConfig(PlatformPersistenceTests.Config.class)
class PlatformPersistenceTests {
 @Configuration @EnableTransactionManagement static class Config {
  @Bean DataSource dataSource(){HikariConfig c=new HikariConfig();c.setJdbcUrl("jdbc:h2:mem:platform_commit;MODE=PostgreSQL;DB_CLOSE_DELAY=-1");c.setAutoCommit(false);return new HikariDataSource(c);}
  @Bean JdbcTemplate jdbc(DataSource ds){return new JdbcTemplate(ds);}
  @Bean PlatformTransactionManager transactions(DataSource ds){return new DataSourceTransactionManager(ds);}
  @Bean PlatformService service(JdbcTemplate jdbc){return new PlatformService(jdbc,new ObjectMapper(),"127.0.0.1",56425,"http://localhost:9401");}
 }
 @Autowired PlatformService service; @Autowired JdbcTemplate jdbc;
 @BeforeEach void schema(){
  jdbc.execute("CREATE TABLE IF NOT EXISTS public.lmc_contacts(id uuid PRIMARY KEY,name text,email text,message text,status text DEFAULT 'new',created_at timestamp DEFAULT CURRENT_TIMESTAMP)");
  jdbc.execute("CREATE TABLE IF NOT EXISTS public.lmc_admin_audit(id bigint GENERATED ALWAYS AS IDENTITY,actor_id uuid,action text,target text,response_status integer,created_at timestamp DEFAULT CURRENT_TIMESTAMP)");
 }
 @Test void contactRemainsCommittedAfterThePooledConnectionIsReturned(){
  var saved=service.contact(Map.of("name","Disposable test","email","commit@example.test","message","Local transaction verification"),UUID.randomUUID().toString());
  assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.lmc_contacts WHERE id=?",Integer.class,saved.get("id")));
 }
 @Test void administratorAuditIsCommittedOutsideAControllerTransaction(){
  UUID actor=UUID.randomUUID();service.audit(actor,"PUT","/api/platform/admin/settings",200);
  assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.lmc_admin_audit WHERE actor_id=?",Integer.class,actor));
 }
}
