import { QueryClient } from "@tanstack/query-core";
import { register } from "../expo_dev_plugins";
import { PluginMessageBridge } from "./PluginMessageBridge";

function broadcastQueryClient(queryClient) {
  register("react-query");
  const proxy = new PluginMessageBridge("react-query");

  let transaction = false;

  const tx = (cb) => {
    transaction = true;
    cb();
    transaction = false;
  };

  const queryCache = queryClient.getQueryCache();

  queryClient.getQueryCache().subscribe((queryEvent) => {
    if (transaction) {
      return;
    }

    const {
      query: { queryHash, queryKey, state },
    } = queryEvent;

    if (queryEvent.type === "updated" && queryEvent.action.type === "success") {
      proxy.sendMessage("updated", {
        queryHash,
        queryKey,
        state,
      });
    }

    if (queryEvent.type === "removed") {
      proxy.sendMessage("removed", {
        queryHash,
        queryKey,
      });
    }
  });

  proxy.addMessageListener("updated", (action) => {
    tx(() => {
      const { queryHash, queryKey, state } = action;

      const query = queryCache.get(queryHash);

      if (query) {
        query.setState(state);
        return;
      }

      queryCache.build(
        queryClient,
        {
          queryKey,
          queryHash,
        },
        state
      );
    });
  });

  proxy.addMessageListener("removed", (action) => {
    tx(() => {
      const { queryHash } = action;
      const query = queryCache.get(queryHash);

      if (query) {
        queryCache.remove(query);
      }
    });
  });

  proxy.addMessageListener("init", () => {
    tx(() => {
      queryClient
        .getQueryCache()
        .getAll()
        .forEach((query) => {
          proxy.sendMessage("updated", {
            queryHash: query.queryHash,
            queryKey: query.queryKey,
            state: query.state,
          });
        });
    });
  });
}

const origMount = QueryClient.prototype.mount;

QueryClient.prototype.mount = function (...args) {
  broadcastQueryClient(this);
  return origMount.apply(this, args);
};
