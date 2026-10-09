import { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";

import { AuthContext } from "./AuthContext";

export const AuthProvider = ({children}) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        let authRevision = 0;
        const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
            if (!active) return;
            authRevision += 1;
            setUser(newSession?.user || null);
            setLoading(false);
        });

        // A newer login/logout event must win over the initial session request.
        const getInitialSession = async () => {
            const revision = authRevision;
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) console.error("Session error:", error);
                if (active && revision === authRevision) {
                    setUser(session?.user || null);
                    setLoading(false);
                }
            } catch (error) {
                console.error("Session error:", error);
                if (active && revision === authRevision) {
                    setUser(null);
                    setLoading(false);
                }
            }
        };
        getInitialSession();

        //clean up auth state to ensure there are no memory leaks, for example when the app/page reloads
        //
        return () => {
            active = false;
            listener.subscription.unsubscribe();
        }
    }, []);

    return (
        <AuthContext.Provider value={{user, loading}}>
            {children}
        </AuthContext.Provider>
    );
};
