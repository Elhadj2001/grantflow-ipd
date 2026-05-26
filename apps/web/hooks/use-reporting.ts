'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  addTemplateMappings,
  createDonorReport,
  createDonorTemplate,
  createStatement,
  getDonorReport,
  getDonorTemplate,
  getStatement,
  listDonorReports,
  listDonorTemplates,
  listStatements,
  lockDonorReport,
  lockStatement,
  sendDonorReport,
  type AddMappingsInput,
  type CreateDonorReportInput,
  type CreateDonorTemplateInput,
  type CreateStatementInput,
  type DonorReportDetail,
  type DonorReportSummary,
  type DonorTemplateDetail,
  type DonorTemplateSummary,
  type FinancialStatementDetail,
  type FinancialStatementSummary,
  type ListDonorReportsQuery,
  type ListStatementsQuery,
  type SendDonorReportInput,
} from '@/lib/api/reporting';
import { mapApiErrorToToast } from '@/lib/use-api';

/**
 * Hooks TanStack Query autour des endpoints `/reporting/*`.
 *
 * Choix de cache :
 *   - staleTime = 5 min sur les templates (peu volatils, peuvent changer
 *     à la création par le CG mais peu fréquent)
 *   - staleTime = 30 s sur les rapports (un rapport peut passer rapidement
 *     de draft → locked → sent en quelques secondes)
 *
 * Invalidations après mutations : on cible les querykeys pertinents
 * (templates / reports / detail concerné).
 */

const FIVE_MIN = 5 * 60 * 1000;
const HALF_MIN = 30 * 1000;

const reportingKeys = {
  all: ['reporting'] as const,
  templates: () => [...reportingKeys.all, 'templates'] as const,
  template: (id: string) => [...reportingKeys.templates(), id] as const,
  reports: () => [...reportingKeys.all, 'donor-reports'] as const,
  reportList: (q: ListDonorReportsQuery) => [...reportingKeys.reports(), 'list', q] as const,
  report: (id: string) => [...reportingKeys.reports(), id] as const,
  // Sprint F5b-b — états financiers TER/BILAN/RESULTAT/FONDS_DEDIES
  statements: () => [...reportingKeys.all, 'statements'] as const,
  statementList: (q: ListStatementsQuery) =>
    [...reportingKeys.statements(), 'list', q] as const,
  statement: (id: string) => [...reportingKeys.statements(), id] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  Templates — queries
// =====================================================================

export function useDonorTemplates() {
  const { accessToken, sessionReady } = useToken();
  return useQuery<DonorTemplateSummary[]>({
    queryKey: reportingKeys.templates(),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listDonorTemplates({ accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useDonorTemplate(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<DonorTemplateDetail>({
    queryKey: reportingKeys.template(id ?? ''),
    enabled: sessionReady && !!id,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getDonorTemplate(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Templates — mutations
// =====================================================================

export function useCreateDonorTemplate() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDonorTemplateInput) =>
      createDonorTemplate(input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.templates() });
    },
  });
}

export function useAddTemplateMappings(templateId: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMappingsInput) =>
      addTemplateMappings(templateId, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.template(templateId) });
      qc.invalidateQueries({ queryKey: reportingKeys.templates() });
    },
  });
}

// =====================================================================
//  Donor reports — queries
// =====================================================================

export function useDonorReports(query: ListDonorReportsQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<DonorReportSummary[]>({
    queryKey: reportingKeys.reportList(query),
    enabled: sessionReady,
    staleTime: HALF_MIN,
    queryFn: async () => {
      try {
        return await listDonorReports(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useDonorReport(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<DonorReportDetail>({
    queryKey: reportingKeys.report(id ?? ''),
    enabled: sessionReady && !!id,
    staleTime: HALF_MIN,
    queryFn: async () => {
      try {
        return await getDonorReport(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Donor reports — mutations
// =====================================================================

export function useCreateDonorReport() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDonorReportInput) =>
      createDonorReport(input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.reports() });
    },
  });
}

export function useLockDonorReport(reportId: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => lockDonorReport(reportId, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.report(reportId) });
      qc.invalidateQueries({ queryKey: reportingKeys.reports() });
    },
  });
}

export function useSendDonorReport(reportId: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendDonorReportInput) =>
      sendDonorReport(reportId, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.report(reportId) });
      qc.invalidateQueries({ queryKey: reportingKeys.reports() });
    },
  });
}

// =====================================================================
//  Sprint F5b-b — Statements (TER / BILAN / RESULTAT / FONDS_DEDIES)
// =====================================================================

/**
 * Liste des états financiers. Le BAILLEUR ne reçoit que les états
 * `locked=true` (filtre serveur F5b-a Lot 1) — pas besoin de filtre UI.
 */
export function useStatements(query: ListStatementsQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<FinancialStatementSummary[]>({
    queryKey: reportingKeys.statementList(query),
    enabled: sessionReady,
    staleTime: HALF_MIN,
    queryFn: async () => {
      try {
        return await listStatements(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useStatement(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<FinancialStatementDetail>({
    queryKey: reportingKeys.statement(id ?? ''),
    enabled: sessionReady && !!id,
    staleTime: HALF_MIN,
    queryFn: async () => {
      try {
        return await getStatement(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useCreateStatement() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<FinancialStatementSummary, Error, CreateStatementInput>({
    mutationFn: (input) => createStatement(input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.statements() });
    },
  });
}

export function useLockStatement(statementId: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<FinancialStatementSummary>({
    mutationFn: () => lockStatement(statementId, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reportingKeys.statement(statementId) });
      qc.invalidateQueries({ queryKey: reportingKeys.statements() });
    },
  });
}
