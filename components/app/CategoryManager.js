"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";

// Ticket categories, managed in place. A Super Admin can manage either
// department; a team head is locked to their own. Anything added here appears
// in the raise-ticket dropdown for that department immediately.
export default function CategoryManager({ departments = ["IT", "Admin"] }) {
  const [department, setDepartment] = useState(departments[0] || "IT");
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api(`/categories?department=${department}`)
      .then((rows) =>
        setCategories(
          [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name))),
        ),
      )
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  const custom = useMemo(
    () => categories.filter((category) => category.custom),
    [categories],
  );
  const standard = useMemo(
    () => categories.filter((category) => !category.custom),
    [categories],
  );

  const add = async () => {
    const value = name.trim();
    if (!value) return toast.error("Enter a category name");
    setBusy(true);
    try {
      await api("/categories", {
        method: "POST",
        body: { name: value, department },
      });
      toast.success(`Added "${value}" to ${department}`);
      setName("");
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category) => {
    setBusy(true);
    try {
      await api(`/categories/${category.id}`, { method: "DELETE" });
      toast.success(`Removed "${category.name}"`);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
      <div className="flex flex-col gap-3 border-b border-[#E5E9EF] px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Tags className="h-5 w-5 shrink-0 text-[#6C5CE7]" />
          <div className="min-w-0">
            <h3 className="font-bold text-[#111827]">Ticket categories</h3>
            <p className="text-xs text-[#697087]">
              Added categories appear in the raise-ticket dropdown straight away.
            </p>
          </div>
        </div>
        {departments.length > 1 && (
          <div className="sm:ml-auto">
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-full bg-white sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departments.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="border-b border-[#E5E9EF] p-5">
        <Label className="text-xs">Add a category to {department}</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            className="h-11"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="e.g. VPN Access Request"
            disabled={busy}
          />
          <Button className="h-11 shrink-0" onClick={add} disabled={busy}>
            <Plus className="mr-1 h-4 w-4" />
            Add category
          </Button>
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-[#697087]">Loading categories…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                Added by your team ({custom.length})
              </p>
              {custom.length ? (
                <div className="flex flex-wrap gap-2">
                  {custom.map((category) => (
                    <span
                      key={category.id}
                      className="flex items-center gap-1.5 rounded-full border border-[#DDD6FE] bg-[#F5F3FF] py-1 pl-3 pr-1.5 text-sm text-[#4C1D95]"
                    >
                      {category.name}
                      <button
                        type="button"
                        title={`Remove ${category.name}`}
                        onClick={() => remove(category)}
                        disabled={busy}
                        className="grid h-6 w-6 place-items-center rounded-full text-[#6D28D9] hover:bg-[#EDE9FE] disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-[#FAFBFC] px-3 py-4 text-center text-xs text-[#9CA3AF]">
                  None yet — anything you add above appears here.
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                Standard categories ({standard.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {standard.map((category) => (
                  <span
                    key={category.id}
                    className="rounded-full bg-[#F0F2F5] px-3 py-1 text-sm text-[#4B5563]"
                  >
                    {category.name}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[#9CA3AF]">
                Standard categories ship with the platform and cannot be removed.
                A category already used by a ticket cannot be removed either.
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
