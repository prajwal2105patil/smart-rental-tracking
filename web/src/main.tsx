import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import App from "./App"
import "./index.css"

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 1,
      // A flat refetchInterval kept re-entering the fetching state while the API was
      // down, so isLoading never settled and the asset panel spun forever. Polling now
      // stops once a query has failed, which lets the error branch actually render.
      refetchInterval: (query) => (query.state.status === "error" ? false : 5000),
    },
  },
})

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
