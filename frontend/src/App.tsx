import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { setTokenGetter, groupsFromAuth } from "./lib/session";
import { useMe } from "./lib/queries";
import { Spinner, ErrorNote, Screen } from "./components/ui";
import Landing from "./routes/Landing";
import JoinEvent from "./routes/JoinEvent";
import ChooseTeam from "./routes/ChooseTeam";
import Challenges from "./routes/Challenges";
import ChallengeDetail from "./routes/ChallengeDetail";
import Scoreboard from "./routes/Scoreboard";
import Judge from "./routes/Judge";
import Admin from "./routes/Admin";
import Nav from "./components/Nav";

export default function App() {
  const auth = useAuth();

  // Registered before any query runs, so the fetch wrapper always has a token.
  useEffect(() => {
    setTokenGetter(() => auth.user?.id_token);
  }, [auth.user]);

  if (auth.isLoading) return <Centered><Spinner /></Centered>;
  if (auth.error) {
    return (
      <Screen title="Sign-in failed">
        <ErrorNote>{auth.error.message}</ErrorNote>
      </Screen>
    );
  }
  if (!auth.isAuthenticated) return <Landing />;

  return <AuthedApp />;
}

function AuthedApp() {
  const auth = useAuth();
  const me = useMe();
  const location = useLocation();
  const groups = groupsFromAuth(auth);

  if (me.isLoading) return <Centered><Spinner /></Centered>;
  if (me.isError) {
    return (
      <Screen title="Something went wrong">
        <ErrorNote>{(me.error as Error).message}</ErrorNote>
      </Screen>
    );
  }

  const user = me.data!;

  // Guards are derived from state we already load, not a separate permission
  // system: no event code -> /join, no team -> /team.
  const gate = !user.eventVerified ? "/join" : !user.teamId ? "/team" : null;
  const onGate = location.pathname === "/join" || location.pathname === "/team";
  // Admins run the event and are not gated by the code.
  const exempt = groups.includes("admins");

  if (gate && !onGate && !exempt) return <Navigate to={gate} replace />;

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/challenges" replace />} />
        <Route path="/auth/callback" element={<Navigate to="/challenges" replace />} />
        <Route path="/join" element={<JoinEvent user={user} />} />
        <Route path="/team" element={<ChooseTeam user={user} />} />
        <Route path="/challenges" element={<Challenges user={user} />} />
        <Route path="/challenges/:id" element={<ChallengeDetail user={user} />} />
        <Route path="/scoreboard" element={<Scoreboard user={user} />} />
        <Route
          path="/judge"
          element={
            groups.some((g) => g === "judges" || g === "admins") ? (
              <Judge />
            ) : (
              <Navigate to="/challenges" replace />
            )
          }
        />
        <Route
          path="/admin"
          element={
            groups.includes("admins") ? <Admin /> : <Navigate to="/challenges" replace />
          }
        />
        <Route path="*" element={<Navigate to="/challenges" replace />} />
      </Routes>
      {!gate && <Nav groups={groups} />}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center">{children}</div>;
}
