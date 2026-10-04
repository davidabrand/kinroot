// Talking to the Kinroot server. Every change sends the X-Requested-With header,
// which other websites can't add, so only this page can edit your tree.
export function createApi(treeId) {
  async function call(method, url, body) {
    const opts = { method, headers: { "X-Requested-With": "Kinroot" } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw new Error("Can't reach Kinroot. Is it still running?");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.location.href = "/login?next=" + encodeURIComponent(location.pathname);
    if (res.status === 403 && !data.error) throw new Error("You don't have permission to change this tree. Ask its owner for edit access.");
    if (!res.ok) throw new Error(data.error || `Something went wrong on Kinroot's side (error ${res.status}), so that wasn't saved. Try again in a moment.`);
    return data;
  }
  const t = `/api/trees/${treeId}`;
  return {
    load: () => call("GET", t),
    addPerson: (data) => call("POST", `${t}/people`, data),
    updatePerson: (id, data) => call("PUT", `${t}/people/${id}`, data),
    deletePerson: (id) => call("DELETE", `${t}/people/${id}`),
    restorePerson: (undo) => call("POST", `${t}/people/restore`, undo),
    uploadPhoto: (id, file) => {
      const fd = new FormData();
      fd.append("photo", file);
      return call("POST", `${t}/people/${id}/photo`, fd);
    },
    removePhoto: (id) => call("DELETE", `${t}/people/${id}/photo`),
    link: (person, other, as) => call("POST", `${t}/relationships`, { person, other, as }),
    unlink: (relId) => call("DELETE", `${t}/relationships/${relId}`),
    claim: (id) => call("POST", `${t}/people/${id}/claim`),
    unclaim: (id) => call("DELETE", `${t}/people/${id}/claim`),
    relationship: (a, b) => call("GET", `${t}/relationship?a=${a}&b=${b}`),
    connect: (userId, note) => call("POST", "/api/family/requests", { user_id: userId, note, via_tree_id: treeId }),
  };
}
