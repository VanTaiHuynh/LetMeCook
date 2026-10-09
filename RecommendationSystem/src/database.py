"""Connection settings for the local Supabase Postgres instance."""
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine,event
from sqlalchemy.engine import URL

load_dotenv()


def get_engine():
    url = os.getenv("RECOMMENDATION_DATABASE_URL")
    if not url:
        url = URL.create(
            "postgresql+pg8000",
            username=os.getenv("SUPABASE_USER", "postgres"),
            password=os.getenv("SUPABASE_PASSWORD", "postgres"),
            host=os.getenv("SUPABASE_HOST", "127.0.0.1"),
            port=int(os.getenv("SUPABASE_PORT", "56422")),
            database=os.getenv("SUPABASE_DB", "postgres"),
        )
    connect_seconds=_bound('RECOMMENDATION_DB_CONNECT_SECONDS',15,1,30)
    query_seconds=_bound('RECOMMENDATION_DB_QUERY_SECONDS',30,1,120)
    pool_size=_bound('RECOMMENDATION_DB_POOL_SIZE',5,1,16)
    pool_wait=_bound('RECOMMENDATION_DB_POOL_WAIT_SECONDS',5,1,10)
    engine=create_engine(url,connect_args={'timeout':connect_seconds},pool_pre_ping=True,
                         pool_size=pool_size,max_overflow=0,pool_timeout=pool_wait)
    def timeout_policy(connection,record):
        cursor=connection.cursor()
        try:cursor.execute(f'SET statement_timeout = {query_seconds*1000}')
        finally:cursor.close()
        # pg8000 starts a transaction for SET. Commit here so pool rollback cannot
        # discard the policy before the first actual read query.
        connection.commit()
    event.listen(engine,'connect',timeout_policy)
    def connection_deadline(dialect,record,args,parameters):
        from src.request_context import remaining,checkpoint
        checkpoint()
        parameters['timeout']=remaining(connect_seconds)
    event.listen(engine,'do_connect',connection_deadline)
    def statement_deadline(connection,cursor,statement,parameters,context,executemany):
        from src.request_context import current,checkpoint
        checkpoint()
        active=current()
        if active is not None:
            # Actual PostgreSQL statement execution is cancelled by the server
            # within the request's remaining budget, including streaming fetches.
            cursor.execute('SET LOCAL statement_timeout = '+str(max(1,int(active.remaining(query_seconds)*1000))))
    event.listen(engine,'before_cursor_execute',statement_deadline)
    def after_statement(*args):
        from src.request_context import checkpoint
        checkpoint()
    event.listen(engine,'after_cursor_execute',after_statement)
    return engine


def _bound(name,default,minimum,maximum):
    try:value=int(os.getenv(name,str(default)))
    except ValueError as error:raise ValueError(f'{name} must be a bounded integer') from error
    if not minimum<=value<=maximum:raise ValueError(f'{name} must be between {minimum} and {maximum}')
    return value
