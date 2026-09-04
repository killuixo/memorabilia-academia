import React, { useState, useEffect, useRef, useMemo } from 'react';

// ==========================================
// CONFIGURAÇÕES DO APLICATIVO
// ==========================================
const getGoogleScriptUrl = () => {
  try {
    return import.meta.env.VITE_GOOGLE_SCRIPT_URL || "";
  } catch (error) {
    return ""; 
  }
};

const GOOGLE_SCRIPT_URL = getGoogleScriptUrl();

// ==========================================
// FUNÇÕES UTILITÁRIAS DE FORMATAÇÃO E OCR
// ==========================================
const cleanDateTimeStr = (str) => {
  if (!str) return '--';
  const s = str.toString();
  if (s.length > 10 && (s.includes('GMT') || s.includes('Horário') || s.includes('Brasília') || s.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/))) {
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
    } catch(e) {}
  }
  return s;
};

const cleanDateStr = (str) => {
  if (!str) return '--';
  const s = str.toString();
  if (s.length > 10 && (s.includes('GMT') || s.includes('Horário') || s.includes('Brasília') || s.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/))) {
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }); 
      }
    } catch(e) {}
  }
  if (s.includes('T') && s.includes('Z')) {
      try {
          const d = new Date(s);
          return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      } catch(e) {}
  }
  return s;
};

const resizeImageForOCR = (file, maxWidth = 1200) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = img.height * (maxWidth / img.width);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png', 1.0)); 
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

const toTitleCase = (str) => {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
            .replace(/\b(De|Do|Da|Dos|Das|E|Em)\b/g, (a) => a.toLowerCase())
            .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi)\b/g, (a) => a.toUpperCase());
};

const parseExtractedText = (rawText) => {
  let parsed = { 
    centro: '', origem: '', escopoConteudo: '', pontoAcesso3: '', produtor: '', pontoAcesso1: '', pontoAcesso2: '', 
    dataDocumento: '', tipoDocumental: '', serie: '', codigo: '', observacoes: ''
  };
  
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = rawLines.join(' ');
  const upperFullText = fullText.toUpperCase();

  const processoMatch = fullText.match(/(23080\.\d{6}\/\d{4}-\d{2})/);
  if (processoMatch) {
      parsed.observacoes = `Processo ${processoMatch[1]}`;
  }

  if (/\bMEN\b/i.test(fullText) || upperFullText.includes('METODOLOGIA DE ENSINO')) {
      parsed.origem = 'MEN';
      parsed.centro = 'CED';
  } else {
      let centroLine = rawLines.find(l => /^CENTRO\b/i.test(l) || /\b(CCE|CED|CFH|CTC|CDS|CCB|CFM|CCS|CCJ|CCA|CSE)\b/i.test(l));
      if (centroLine) {
          let match = centroLine.match(/(?:-|–|—)\s*([A-Z]{3,4})\b/);
          if (match) {
              parsed.centro = match[1];
          } else {
              const upper = centroLine.toUpperCase();
              if (upper.includes('COMUNICA') || upper.includes('EXPRESS')) parsed.centro = 'CCE';
              else if (upper.includes('EDUCA')) parsed.centro = 'CED';
              else if (upper.includes('FILOSOFIA') || upper.includes('HUMANAS')) parsed.centro = 'CFH';
              else if (upper.includes('TECNOL')) parsed.centro = 'CTC';
              else if (upper.includes('DESPORTO') || upper.includes('FISICA')) parsed.centro = 'CDS';
              else if (upper.includes('BIOLOG')) parsed.centro = 'CCB';
              else if (upper.includes('SAUDE') || upper.includes('SAÚDE')) parsed.centro = 'CCS';
              else if (upper.includes('JURID') || upper.includes('DIREITO')) parsed.centro = 'CCJ';
              else if (upper.includes('AGRAR')) parsed.centro = 'CCA';
              else if (upper.includes('SOCIO') || upper.includes('ECONOM')) parsed.centro = 'CSE';
              else {
                  let matchSigla = centroLine.match(/\b([A-Z]{3,4})\b/);
                  parsed.centro = matchSigla ? matchSigla[1] : '';
              }
          }
      } else if (upperFullText.includes('CED')) parsed.centro = 'CED';
      else if (upperFullText.includes('CCE')) parsed.centro = 'CCE';
      else if (upperFullText.includes('CFH')) parsed.centro = 'CFH';
  }

  if (!parsed.origem) {
      let origemLine = rawLines.find(l => /^ORIGEM[:\s]*|^CURSO\b/i.test(l));
      let deptoLine = rawLines.find(l => /^DEPARTAMENTO\b/i.test(l));

      if (origemLine) {
         let textOrigem = origemLine.replace(/^(?:ORIGEM|CURSO(?: DE)?)[:\s]*/i, '').replace(/\b(?:da|de)\s+(?:universidade|ufsc).*/i, '');
         parsed.origem = toTitleCase(textOrigem.replace(/[^a-zA-ZÀ-ÿ\s/.-]/g, '').trim());
      } else if (deptoLine) {
         let textDepto = deptoLine.replace(/^DEPARTAMENTO(?: DE)?\s*/i, '');
         parsed.origem = toTitleCase(textDepto.replace(/[^a-zA-ZÀ-ÿ\s/.-]/g, '').trim());
      } else {
         let cursoMatch = fullText.match(/curso\s+(?:de\s+)?([a-zA-ZÀ-ÿ\s/-]+?)(?:,|\.|\s+(?:da|de)\s+(?:universidade|ufsc)|$)/i);
         if (cursoMatch) parsed.origem = toTitleCase(cursoMatch[1].replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
      }
  }

  let reqLineIndex = rawLines.findIndex(l => /^(?:Requerente|Interessado)[:\s]*/i.test(l));
  if (reqLineIndex !== -1) {
      let prodText = rawLines[reqLineIndex].replace(/^(?:Requerente|Interessado)[:\s]*/i, '').trim();
      if (/23080\./.test(prodText) || prodText === '') {
          if (rawLines[reqLineIndex + 1]) prodText = rawLines[reqLineIndex + 1].trim();
      }
      prodText = prodText.split(/(?:-|–|—)/)[0];
      parsed.produtor = toTitleCase(prodText.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim());
  } else {
      let rawStudentIndex = rawLines.findIndex(l => /^(?:Acad[eê]mic[oa]s?\s*:?|Alun[oa]s?\s*:?)\b/i.test(l));
      let students = [];
      if (rawStudentIndex !== -1) {
          let firstStudentLine = rawLines[rawStudentIndex].replace(/^(?:Acad[eê]mic[oa]s?\s*:?|Alun[oa]s?\s*:?)\s*/i, '');
          let cleanedFirst = firstStudentLine.split(/(?:-|–|—)/)[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
          if (cleanedFirst.includes(' ') && cleanedFirst.length > 4) students.push(toTitleCase(cleanedFirst));
          
          for (let i = rawStudentIndex + 1; i <= rawStudentIndex + 2 && i < rawLines.length; i++) {
              if (rawLines[i].length <= 2 || rawLines[i].trim() === '') break; 
              let cleaned = rawLines[i].split(/(?:-|–|—)/)[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
              if (cleaned.includes(' ') && cleaned.length > 4 && !/["“”:]/.test(rawLines[i])) students.push(toTitleCase(cleaned));
              else break;
          }
      } else {
          let topLines = rawLines.slice(0, 6).filter(l => !/UNIVERSIDADE|FEDERAL|CENTRO|CURSO|DISCIPLINA|TRABALHO|RELATÓRIO|SUMÁRIO|PROCESSO|"/i.test(l));
          for (let l of topLines) {
              let cleaned = l.split(/(?:-|–|—)/)[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
              if (cleaned.includes(' ') && cleaned.length > 5 && cleaned.length < 50 && !/["“”:]/.test(l)) students.push(toTitleCase(cleaned));
          }
      }
      if (students[0]) parsed.produtor = students[0];
      if (students[1]) parsed.pontoAcesso1 = students[1];
      if (students[2]) parsed.pontoAcesso2 = students[2];
  }

  let profLine = rawLines.find(l => /(?:Prof|Professor|Orientador)/i.test(l));
  if (profLine) {
      let profText = profLine.replace(/^(.*?(?:Prof[a-zªº.]*|Professor[a]?|Orientador[a]?)[.:\s]*)/i, '').replace(/^(?:Mst|Dra?|MSc|Esp)\b[.:\s]*/i, '');
      parsed.pontoAcesso3 = toTitleCase(profText.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim());
  }

  let assuntoTexto = '';
  let origemDesalinhada = rawLines.find(l => /^Origem[:\s]*/i.test(l) && /PROGRESS[AÃ]O/i.test(l));

  if (origemDesalinhada) {
      assuntoTexto = origemDesalinhada.replace(/^Origem[:\s]*/i, '').trim();
      let idx = rawLines.indexOf(origemDesalinhada);
      if (rawLines[idx + 1] && !/^(?:Assunto|Palavra)/i.test(rawLines[idx + 1])) assuntoTexto += ' ' + rawLines[idx + 1].trim();
      if (rawLines[idx + 2] && !/^(?:Assunto|Palavra)/i.test(rawLines[idx + 2])) assuntoTexto += ' ' + rawLines[idx + 2].trim();
  } else {
      let assuntoIndex = rawLines.findIndex(l => /^(?:Assunto|Detalhamento)[:\s]*/i.test(l));
      if (assuntoIndex !== -1) {
          assuntoTexto = rawLines[assuntoIndex].replace(/^(?:Assunto|Detalhamento)[:\s]*/i, '');
          for (let i = assuntoIndex + 1; i < rawLines.length; i++) {
              if (/^(?:Palavra\s*Chave|Detalhamento|Origem|Requerente|Data|\d{2}-EST[ÁA]GIO|SUM[ÁA]RIO)/i.test(rawLines[i])) break;
              assuntoTexto += ' ' + rawLines[i];
          }
      }
  }

  if (assuntoTexto) {
      parsed.escopoConteudo = toTitleCase(assuntoTexto.replace(/[^a-zA-ZÀ-ÿ\s/.-]/g, '').trim());
  } else {
      let discLine = rawLines.find(l => /^DISCIPLINA[:\s]*/i.test(l));
      let codDiscLine = rawLines.find(l => /^([A-Z]{3})\s*(\d{4})\s*[-–—]\s*(.+)/i.test(l));

      if (discLine) {
         let textDisc = discLine.replace(/^DISCIPLINA[:\s]*/i, '').replace(/(?:-|–|—)\s*[A-Z]{3}\s*\d{4}.*/i, '');
         parsed.escopoConteudo = toTitleCase(textDisc.replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
      } else if (codDiscLine) {
         let match = codDiscLine.match(/^([A-Z]{3})\s*(\d{4})\s*[-–—]\s*(.+)/i);
         let textDisc = match[3].replace(/(?:-|–|—)\s*\d+\s*cr[ée]ditos.*/i, '');
         parsed.escopoConteudo = toTitleCase(textDisc.replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
      } else {
         let discMatch = fullText.match(/disciplina\s+(?:de\s+)?([a-zA-ZÀ-ÿ\s/IV]+?)(?:,|\.|\s+do curso|\s+da universidade|$)/i);
         if (discMatch) {
            parsed.escopoConteudo = toTitleCase(discMatch[1].replace(/[^a-zA-ZÀ-ÿ\s/IV]/gi, '').trim());
         } else if (profLine) {
            let profIndex = rawLines.indexOf(profLine);
            if (profIndex > 0) {
               let lineAbove = rawLines[profIndex - 1];
               if (!/CENTRO|CURSO|UNIVERSIDADE|PROGRAMA/i.test(lineAbove)) {
                  parsed.escopoConteudo = toTitleCase(lineAbove.replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
               }
            }
         }
      }
  }

  let intervalMatch = fullText.match(/\b(19\d{2}|20\d{2})\s*(?:-|a|~|à)\s*(19\d{2}|20\d{2})\b/i);
  if (intervalMatch) {
      parsed.dataDocumento = `${intervalMatch[1]} a ${intervalMatch[2]}`;
  } else {
      let fullDateMatch = fullText.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
      if (fullDateMatch) {
          let year = fullDateMatch[3].length === 2 ? (parseInt(fullDateMatch[3]) > 50 ? '19'+fullDateMatch[3] : '20'+fullDateMatch[3]) : fullDateMatch[3];
          let month = fullDateMatch[2].padStart(2, '0');
          let day = fullDateMatch[1].padStart(2, '0');
          parsed.dataDocumento = `${day}/${month}/${year}`;
      } else {
          let textDateMatch = fullText.match(/([a-zA-Zç]+)\s+de\s+(20\d{2}|19\d{2})/i);
          if (textDateMatch) {
              parsed.dataDocumento = `${textDateMatch[1].substring(0,3)}/${textDateMatch[2]}`;
          } else {
              let yearMatch = fullText.match(/\b(19\d{2}|20\d{2})\b/g);
              if (yearMatch) {
                  let maxYear = Math.max(...yearMatch.map(Number));
                  parsed.dataDocumento = `${maxYear}`;
              }
          }
      }
  }

  if (upperFullText.includes('PROGRESSÃO') || upperFullText.includes('PROGRESSAO') || upperFullText.includes('PROMOÇÃO') || upperFullText.includes('PROMOCAO')) {
      parsed.tipoDocumental = upperFullText.includes('MEMORIAL') ? 'Memorial Descritivo' : 'Processo Administrativo';
      parsed.serie = 'Avaliação de Desempenho - Progressão Funcional';
      parsed.codigo = "022.63 - Promoção e progressão funcional";
  } else if (upperFullText.includes('ESTÁGIO PROBATÓRIO') || upperFullText.includes('ESTAGIO PROBATORIO')) {
      parsed.tipoDocumental = upperFullText.includes('MEMORIAL') ? 'Memorial Descritivo' : 'Processo Administrativo';
      parsed.serie = 'Processos de Estágio Probatório';
      parsed.codigo = "022.61 - Cumprimento de estágio probatório. Homologação da estabilidade";
  } else if (upperFullText.includes('AFASTAMENTO') || upperFullText.includes('EVENTO') || upperFullText.includes('VIAGEM')) {
      parsed.tipoDocumental = 'Processo Administrativo';
      if (upperFullText.includes('EXTERIOR') || upperFullText.includes('PAÍS') || upperFullText.includes('PAIS')) {
          parsed.serie = 'Afastamentos para o Exterior';
          parsed.codigo = "028.21 - Cumprimento de missões e viagens a serviço - no exterior - com ônus";
      } else {
          parsed.serie = 'Afastamentos no País';
          parsed.codigo = "028.11 - Cumprimento de missões e viagens a serviço - no país - com ônus";
      }
  } else if (upperFullText.includes('PROGRAMA') && (upperFullText.includes('OBJETIVO DA DISCIPLINA') || upperFullText.includes('BIBLIOGRAFIA') || upperFullText.includes('PLANO DE ENSINO') || upperFullText.includes('CRÉDITOS'))) {
      parsed.tipoDocumental = 'Plano de Ensino / Programa';
      parsed.serie = 'Programas de Disciplinas';
      parsed.codigo = "122.3 - Disciplinas: programas didáticos";
  } else if (upperFullText.includes('RELATÓRIO') || upperFullText.includes('RELATORIO') || upperFullText.includes('PRÁTICA') || upperFullText.includes('PRATICA')) {
      parsed.tipoDocumental = 'Relatório';
      parsed.serie = 'Relatórios de Estágio Obrigatório';
      parsed.codigo = "125.31 - Provas. Exames. Trabalhos";
  } else if (upperFullText.includes('TCC') || upperFullText.includes('MONOGRAFIA') || upperFullText.includes('CONCLUSÃO DE CURSO')) {
      parsed.tipoDocumental = 'Monografia / TCC';
      parsed.serie = 'Trabalhos de Conclusão de Curso';
      parsed.codigo = "125.32 - Trabalho de conclusão de curso";
  } else if (upperFullText.includes('DOSSIÊ') || upperFullText.includes('DOSSIE')) {
      parsed.tipoDocumental = 'Dossiê';
      parsed.serie = 'Assentamentos Individuais';
      parsed.codigo = "125.43 - Assentamentos individuais dos alunos (Dossiês)";
  }

  return parsed;
};

const PieChart = ({ data, title, onFilter }) => {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  if (total === 0) return <div className="p-4 text-center text-sm font-bold text-gray-400 border-[4px] border-black min-h-[250px] bg-white flex items-center justify-center">Sem dados</div>;

  const slices = data.map((item, idx) => {
      const percentage = (item.value / total) * 100;
      const color = `hsl(${(idx * 360) / Math.max(1, data.length)}, 70%, 50%)`;
      return { ...item, percentage, color };
  });

  let cumulativePercent = 0;

  return (
    <div className="flex flex-col bg-white p-4 md:p-6 border-[4px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] h-full">
      <h3 className="font-black text-sm uppercase tracking-widest mb-6 border-b-[2px] border-black pb-2">{title}</h3>
      <div className="flex flex-col items-center gap-6 justify-center flex-1">
        
        <div className="relative w-36 h-36 md:w-44 md:h-44 flex-shrink-0">
          <svg viewBox="0 0 32 32" className="w-full h-full transform -rotate-90 rounded-full border-[4px] border-black bg-white">
            {slices.map((slice, idx) => {
              const dasharray = `${slice.percentage} ${100 - slice.percentage}`;
              const dashoffset = -cumulativePercent;
              cumulativePercent += slice.percentage;
              return (
                <circle
                  key={idx}
                  cx="16" cy="16" r="15.915494309189533"
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth="32"
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 m-auto w-16 h-16 md:w-20 md:h-20 bg-white rounded-full border-[4px] border-black flex items-center justify-center z-10 shadow-inner">
            <span className="font-black text-base md:text-xl">{total}</span>
          </div>
        </div>

        <div className="w-full flex flex-col gap-3 max-h-[220px] overflow-y-auto pr-2 mt-4">
          {slices.map((item, idx) => (
            <div 
              key={idx} 
              onClick={() => onFilter && onFilter(item.filterKey, item.label)}
              className="flex justify-between items-start text-[10px] md:text-xs font-bold uppercase tracking-wider gap-2 cursor-pointer hover:bg-yellow-100 p-1 rounded transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="w-3 h-3 md:w-4 md:h-4 mt-0.5 border-[2px] border-black flex-shrink-0" style={{ backgroundColor: item.color }}></div>
                <span className="leading-tight text-left break-words line-clamp-2 underline decoration-dotted">{item.label}</span>
              </div>
              <span className="flex-shrink-0 font-black">{item.value} <span className="opacity-50 font-normal">({item.percentage.toFixed(1)}%)</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const BarChart = ({ data, title, color = "#00bcd4", onFilter }) => {
  const maxVal = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="flex flex-col bg-white p-4 md:p-6 border-[4px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] w-full min-h-[385px] md:min-h-[420px]">
      <h3 className="font-black text-sm uppercase tracking-widest mb-6 border-b-[2px] border-black pb-2">{title}</h3>
      {data.length === 0 ? (
         <div className="flex-1 flex items-center justify-center text-sm font-bold text-gray-400">Sem dados</div>
      ) : (
        <div className="flex-1 flex items-end justify-start w-full gap-4 border-b-[4px] border-l-[4px] border-black pb-32 pt-10 pl-3 overflow-x-auto overflow-y-visible relative min-h-[300px]">
          {data.map((item, idx) => (
            <div 
              key={idx} 
              onClick={() => onFilter && onFilter(item.filterKey, item.label)}
              className="flex flex-col items-center justify-end flex-shrink-0 min-w-[36px] md:min-w-[48px] h-full group relative cursor-pointer"
            >
              <span className="absolute -top-7 text-[10px] font-black opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white px-1.5 py-0.5 z-20 rounded shadow">{item.value}</span>
              <div className="w-full border-[2px] border-black hover:opacity-80 transition-opacity relative" style={{ height: `${Math.max((item.value / maxVal) * 100, 4)}%`, backgroundColor: color }}></div>
              <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 translate-y-full -rotate-45 origin-top-left flex items-start w-[110px]">
                  <span className="text-[9px] md:text-[10px] font-black uppercase truncate w-full text-right underline decoration-dotted" title={item.label}>
                     {item.label}
                  </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('registro'); 
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data de análise', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [viewMode, setViewMode] = useState('list'); 
  
  const [modalFilter, setModalFilter] = useState(null); 

  const initialFormState = {
    pacote: '', idItem: '', centro: '', origem: '',
    produtor: '', pontoAcesso1: '', pontoAcesso2: '', pontoAcesso3: '',
    escopoConteudo: '', dataDocumento: '', codigo: '', tipoDocumental: '', serie: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [ocrStatus, setOcrStatus] = useState('idle');
  const fileInputRef = useRef(null);

  const fetchItems = async () => {
    if (!GOOGLE_SCRIPT_URL) return;
    setLoadingList(true);
    setFetchError('');
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) setItems(data);
        else setFetchError("Erro: A resposta não é uma lista válida.");
      } catch(e) { setFetchError("Erro de formatação JSON no Script."); }
    } catch (err) { setFetchError("Falha de comunicação com a planilha."); } 
    finally { setLoadingList(false); }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (activeTab === 'acervo' || activeTab === 'dashboard') fetchItems();
  }, [activeTab]);

  useEffect(() => {
    if (items.length === 0) return;
    const lastItem = items[items.length - 1]; 
    setFormData(prev => {
      let updates = {};
      const autoPacote = lastItem["ID Pacote"] || '';
      if (!prev.pacote && autoPacote) updates.pacote = autoPacote;

      const lastIdItem = lastItem["ID Item"] || '';
      if (lastIdItem && !prev.idItem) {
        const match = lastIdItem.match(/^(.*?)(\d+)$/);
        if (match) {
          const prefix = match[1];
          const numStr = match[2];
          const nextNum = parseInt(numStr, 10) + 1;
          updates.idItem = `${prefix}${String(nextNum).padStart(numStr.length, '0')}`;
        }
      }
      if (Object.keys(updates).length > 0) return { ...prev, ...updates };
      return prev;
    });
  }, [items]);

  const uniqueOrigens = [...new Set(items.map(i => i["Origem"]).filter(Boolean))];
  const uniqueEscopos = [...new Set(items.map(i => i["Escopo e Conteúdo"]).filter(Boolean))];
  const uniquePontosAcesso = [...new Set([
      ...items.map(i => i["Ponto de Acesso 1"]),
      ...items.map(i => i["Ponto de Acesso 2"]),
      ...items.map(i => i["Ponto de Acesso 3"]),
      ...items.map(i => i["Orientador"]), 
      ...items.map(i => i["Estudante 2"]),
      ...items.map(i => i["Estudante 3"])
  ].filter(Boolean))];
  const uniqueProdutores = [...new Set(items.map(i => i["Produtor"]).filter(Boolean))];
  const uniqueSeries = [...new Set(items.map(i => i["Série"]).filter(Boolean))];
  const uniqueTipos = [...new Set(items.map(i => i["Tipo Documental"]).filter(Boolean))];
  const uniqueCodigos = [...new Set(items.map(i => i["Código de Classificação"]).filter(Boolean))];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const base64Image = await resizeImageForOCR(file);
      const worker = await window.Tesseract.createWorker('por');
      const ret = await worker.recognize(base64Image);
      const text = ret.data.text;
      await worker.terminate();

      const parsedData = parseExtractedText(text);

      setFormData(prev => ({
        ...prev,
        centro: parsedData.centro || prev.centro,
        origem: parsedData.origem || prev.origem,
        escopoConteudo: parsedData.escopoConteudo || prev.escopoConteudo,
        pontoAcesso3: parsedData.pontoAcesso3 || prev.pontoAcesso3,
        dataDocumento: parsedData.dataDocumento || prev.dataDocumento,
        produtor: parsedData.produtor || prev.produtor,
        pontoAcesso1: parsedData.pontoAcesso1 || prev.pontoAcesso1,
        pontoAcesso2: parsedData.pontoAcesso2 || prev.pontoAcesso2,
        codigo: parsedData.codigo || prev.codigo,
        tipoDocumental: parsedData.tipoDocumental || prev.tipoDocumental,
        serie: parsedData.serie || prev.serie,
        observacoes: parsedData.observacoes || prev.observacoes
      }));

      setOcrStatus('success');
      setTimeout(() => setOcrStatus('idle'), 3000);
    } catch (err) {
      setOcrStatus('error');
      setTimeout(() => setOcrStatus('idle'), 4000);
    }
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmAndSubmit = async () => {
    setShowConfirm(false);
    if (!GOOGLE_SCRIPT_URL) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      setFormData(prev => ({
        ...initialFormState,
        pacote: prev.pacote,
        centro: prev.centro,
        origem: prev.origem,
        idItem: ''
      }));
      fetchItems();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key] ? a[sortConfig.key].toString().toLowerCase() : '';
    const bValue = b[sortConfig.key] ? b[sortConfig.key].toString().toLowerCase() : '';
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const dashboardStats = useMemo(() => {
    const stats = { origem: {}, mesAno: {}, ano: {}, decada: {}, codigo: {} };

    items.forEach(item => {
      const origem = item["Origem"] || "Não Informado";
      stats.origem[origem] = (stats.origem[origem] || 0) + 1;

      const dataStr = cleanDateStr(item["Data do documento"]);
      if (dataStr && dataStr !== '--') {
        const yearMatch = dataStr.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) {
            const ano = yearMatch[1];
            stats.ano[ano] = (stats.ano[ano] || 0) + 1;
            const decada = Math.floor(parseInt(ano) / 10) * 10;
            stats.decada[`${decada}s`] = (stats.decada[`${decada}s`] || 0) + 1;
        }

        const mesAnoLabel = dataStr.substring(0, 20); 
        stats.mesAno[mesAnoLabel] = (stats.mesAno[mesAnoLabel] || 0) + 1;
      }

      const codigo = item["Código de Classification"] || item["Código de Classificação"] || "Sem Código";
      stats.codigo[codigo] = (stats.codigo[codigo] || 0) + 1;
    });

    const formatData = (obj, sortFn, filterKey) => Object.entries(obj).map(([label, value]) => ({ label, value, filterKey })).sort(sortFn);

    return {
      origem: formatData(stats.origem, (a, b) => b.value - a.value, 'Origem').slice(0, 15),
      mesAno: formatData(stats.mesAno, (a, b) => a.label.localeCompare(b.label), 'Data do documento').slice(-15),
      ano: formatData(stats.ano, (a, b) => a.label.localeCompare(b.label), 'Data do documento').slice(-15),
      decada: formatData(stats.decada, (a, b) => a.label.localeCompare(b.label), 'Data do documento'),
      codigo: formatData(stats.codigo, (a, b) => b.value - a.value, 'Código de Classificação').slice(0, 10),
    };
  }, [items]);

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-4 md:py-6 px-2 md:px-4 font-sans selection:bg-[#ffb300]">
      
      {/* Modal Ficha Resumo Universal */}
      {modalFilter && (
        <div className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-white border-[8px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-5xl max-h-[90vh] flex flex-col">
              <div className="p-4 bg-[#00bcd4] text-black flex justify-between items-start md:items-center border-b-[6px] border-black flex-col md:flex-row gap-4">
                 <div>
                    <h2 className="font-black uppercase text-xs md:text-sm tracking-widest opacity-80">Ficha Resumo: {modalFilter.label}</h2>
                    <h3 className="font-black text-lg md:text-2xl mt-1 leading-tight">{modalFilter.value}</h3>
                 </div>
                 <button onClick={() => setModalFilter(null)} className="w-12 h-12 flex-shrink-0 border-[4px] border-black bg-white font-black text-xl hover:bg-red-500 hover:text-white transition-colors active:translate-y-1 active:translate-x-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none">X</button>
              </div>
              <div className="p-4 overflow-y-auto bg-gray-50 flex-1">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.filter(i => (i[modalFilter.key] || i["Código de Classification"]) === modalFilter.value).map((item, idx) => (
                       <div key={idx} className="border-[4px] border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2 text-sm">
                          <div className="flex justify-between border-b-[2px] border-black pb-2">
                             <span className="font-black text-[#c2185b]">{item["ID Item"]}</span>
                             <span className="font-bold">{cleanDateStr(item["Data do documento"])}</span>
                          </div>
                          <div className="font-bold uppercase tracking-wider">
                             <span onClick={() => setModalFilter({key: 'Centro', value: item["Centro"], label: 'Centro'})} className="cursor-pointer hover:underline">{item["Centro"]}</span> - <span onClick={() => setModalFilter({key: 'Origem', value: item["Origem"], label: 'Origem'})} className="cursor-pointer hover:underline">{item["Origem"]}</span>
                          </div>
                          <div className="font-black text-lg leading-tight">{item["Escopo e Conteúdo"]}</div>
                          <div className="mt-2 text-xs uppercase tracking-widest border-t-[2px] border-dotted border-gray-300 pt-2 flex flex-col gap-1">
                              <div><span className="opacity-50">Produtor:</span> <span onClick={() => setModalFilter({key: 'Produtor', value: item["Produtor"], label: 'Produtor'})} className="cursor-pointer hover:underline font-bold text-black">{item["Produtor"] || '--'}</span></div>
                              {(item["Tipo Documental"] || item["Série"]) && (
                                 <div className="text-[10px] text-gray-500 font-bold">
                                    <span onClick={() => setModalFilter({key: 'Tipo Documental', value: item["Tipo Documental"], label: 'Tipo Documental'})} className="cursor-pointer hover:underline">{item["Tipo Documental"]}</span> • <span onClick={() => setModalFilter({key: 'Série', value: item["Série"], label: 'Série'})} className="cursor-pointer hover:underline">{item["Série"]}</span>
                                 </div>
                              )}
                          </div>
                          {(item["Código de Classificação"] || item["Código de Classification"]) && (
                              <div className="mt-2 text-[10px] font-black uppercase bg-[#e0f7fa] border-[2px] border-black px-2 py-1 text-cyan-800 w-fit cursor-pointer hover:bg-cyan-200" onClick={() => setModalFilter({key: 'Código de Classificação', value: item["Código de Classificação"] || item["Código de Classification"], label: 'Código de Classificação'})}>
                                  🏷️ {item["Código de Classificação"] || item["Código de Classification"]}
                              </div>
                          )}
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>
      )}

      <div className="w-full max-w-6xl bg-white border-[6px] md:border-[12px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row border-b-[6px] md:border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-4 md:p-6 text-white border-b-[6px] md:border-b-0 md:border-r-[12px] border-black flex items-center gap-4">
            <img src="https://raw.githubusercontent.com/killuixo/memorabilia-academia/refs/heads/main/icon.png" alt="Ícone" className="w-12 h-12 md:w-16 md:h-16 border-[3px] border-black bg-white object-contain shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" />
            <div>
              <h1 className="text-2xl md:text-5xl font-black uppercase tracking-tighter">MEMORABILIA - ACADEMIA</h1>
              <p className="mt-1 text-pink-200 font-bold text-xs md:text-sm">Triagem Arquivística Acadêmica</p>
            </div>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300] min-w-[250px]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-2 md:px-4 py-3 md:py-4 font-black uppercase tracking-wider text-[10px] md:text-xl border-b-[6px] md:border-b-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-2 md:px-4 py-3 md:py-4 font-black uppercase tracking-wider text-[10px] md:text-xl border-b-[6px] md:border-b-[12px] border-black transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Ver Acervo
            </button>
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`flex-1 px-2 md:px-4 py-3 md:py-4 font-black uppercase tracking-wider text-[10px] md:text-xl transition-colors ${activeTab === 'dashboard' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Dashboard
            </button>
          </div>
        </div>

        {/* REGISTRAR */}
        {activeTab === 'registro' && (
          <div className="flex flex-col bg-white p-4 md:p-6 relative">
            
            <datalist id="codigosSiga">
              {uniqueCodigos.map((cod, idx) => <option key={`cod-${idx}`} value={cod} />)}
              <option value="022.61 - Cumprimento de estágio probatório. Homologação da estabilidade" />
              <option value="022.63 - Promoção e progressão funcional" />
              <option value="028.11 - Cumprimento de missões e viagens a serviço - no país - com ônus" />
              <option value="028.21 - Cumprimento de missões e viagens a serviço - no exterior - com ônus" />
              <option value="122.3 - Disciplinas: programas didáticos" />
              <option value="125.31 - Provas. Exames. Trabalhos" />
              <option value="125.32 - Trabalho de conclusão de curso" />
              <option value="125.43 - Assentamentos individuais dos alunos (Dossiês)" />
            </datalist>
            
            <datalist id="listaOrigens">
              {uniqueOrigens.map((ori, idx) => <option key={`ori-${idx}`} value={ori} />)}
            </datalist>

            <datalist id="listaEscopos">
              {uniqueEscopos.map((esc, idx) => <option key={`esc-${idx}`} value={esc} />)}
            </datalist>
            
            <datalist id="listaPontosAcesso">
              {uniquePontosAcesso.map((pa, idx) => <option key={`pa-${idx}`} value={pa} />)}
            </datalist>

            <datalist id="listaProdutores">
              {uniqueProdutores.map((est, idx) => <option key={`prod-${idx}`} value={est} />)}
            </datalist>

            <datalist id="listaTipos">
              {uniqueTipos.map((tipo, idx) => <option key={`tipo-${idx}`} value={tipo} />)}
            </datalist>

            <datalist id="listaSeries">
              {uniqueSeries.map((serie, idx) => <option key={`serie-${idx}`} value={serie} />)}
            </datalist>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b-[4px] border-black pb-4">
              <span className="font-black text-gray-400 uppercase tracking-widest text-xs md:text-sm">Ficha de Inserção Arquivística</span>
              
              <button 
                type="button"
                onClick={() => fileInputRef.current.click()}
                className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-3 bg-white border-[3px] border-black text-black font-black text-sm uppercase hover:bg-gray-100 transition-colors cursor-pointer shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none"
              >
                <span role="img" aria-label="Camera">📷</span>
                {ocrStatus === 'loading' ? 'Lendo Capa...' : 'Ler Capa (Câmera)'}
              </button>

              <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
            </div>

            {ocrStatus === 'success' && <div className="mb-6 p-3 bg-[#00bcd4] border-[3px] border-black font-black text-xs md:text-sm uppercase text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">✓ Campos preenchidos automaticamente! Por favor, revise.</div>}
            {ocrStatus === 'error' && <div className="mb-6 p-3 bg-[#c2185b] border-[3px] border-black font-black text-xs md:text-sm uppercase text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">⚠ Erro ao processar a imagem. Tente novamente ou preencha manualmente.</div>}

            {showConfirm ? (
              <div className="flex flex-col gap-6 animate-in fade-in duration-300">
                <h2 className="text-2xl md:text-3xl font-black uppercase text-[#c2185b] mb-2 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs md:text-base">
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Origem:</strong> <br/>{formData.origem || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Escopo e Conteúdo:</strong> <br/>{formData.escopoConteudo || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Produtor (Requerente):</strong> <br/>{formData.produtor || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-gray-100"><strong className="text-gray-500 uppercase">Pontos de Acesso:</strong> <br/>{[formData.pontoAcesso1, formData.pontoAcesso2, formData.pontoAcesso3].filter(Boolean).join(' | ') || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Data do Documento:</strong> <br/>{formData.dataDocumento || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Tipo Documental:</strong> <br/>{formData.tipoDocumental || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Série:</strong> <br/>{formData.serie || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Código Classificação IFES/SIGA:</strong> <br/>{formData.codigo || '-'}</div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 mt-4">
                   <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[4px] md:border-[6px] border-black py-4 font-black uppercase tracking-wider text-sm md:text-xl hover:bg-cyan-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none">Salvar na Planilha</button>
                   <button onClick={() => setShowConfirm(false)} className="flex-1 bg-white border-[4px] md:border-[6px] border-black py-4 font-black uppercase tracking-wider text-sm md:text-xl hover:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none">Voltar e Editar</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handlePreSubmit} className="flex flex-col gap-6 md:gap-8">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 bg-[#e0f7fa] p-4 md:p-6 border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">ID Pacote *</label>
                    <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm md:text-lg font-mono focus:outline-none focus:bg-white uppercase" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">ID Item *</label>
                    <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm md:text-lg font-mono focus:outline-none focus:bg-[#f8bbd0] uppercase" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 bg-[#ffe082] p-4 md:p-6 border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Centro</label>
                    <input type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm focus:outline-none focus:bg-white font-bold uppercase" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Origem</label>
                    <input type="text" list="listaOrigens" name="origem" value={formData.origem} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm focus:outline-none focus:bg-white font-bold" />
                  </div>
                </div>

                <div className="flex flex-col gap-4 md:gap-6 p-4 md:p-6 border-[4px] md:border-[6px] border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Escopo e Conteúdo (Assunto / Disciplina) *</label>
                    <input required type="text" list="listaEscopos" name="escopoConteudo" value={formData.escopoConteudo} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm font-bold focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">Produtor (Requerente / Sujeito) *</label>
                    <input required type="text" list="listaProdutores" name="produtor" value={formData.produtor} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm font-bold focus:outline-none focus:bg-[#ffe082]" />
                  </div>

                  <details className="w-full border-[3px] border-black bg-white group cursor-pointer mt-2">
                    <summary className="font-black text-black uppercase tracking-wide text-[10px] md:text-xs p-3 md:p-4 bg-gray-100 group-open:border-b-[3px] border-black hover:bg-gray-200 transition-colors">
                      ▶ Pontos de Acesso (Estudantes, Orientadores...)
                    </summary>
                    <div className="p-4 md:p-6 flex flex-col gap-4 bg-white cursor-default">
                      <div className="flex flex-col gap-2">
                        <label className="font-black text-black uppercase tracking-wide text-xs text-gray-700">Ponto de Acesso 3 (Ex: Orientador(a))</label>
                        <input type="text" list="listaPontosAcesso" name="pontoAcesso3" value={formData.pontoAcesso3} onChange={handleChange} className="w-full border-[2px] border-black p-2 text-sm font-bold focus:outline-none focus:bg-pink-50" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                          <label className="font-black text-black uppercase tracking-wide text-[10px] text-gray-500">Ponto de Acesso 1</label>
                          <input type="text" list="listaPontosAcesso" name="pontoAcesso1" value={formData.pontoAcesso1} onChange={handleChange} className="w-full border-[2px] border-black p-2 text-sm font-bold focus:outline-none focus:bg-gray-50" />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="font-black text-black uppercase tracking-wide text-[10px] text-gray-500">Ponto de Acesso 2</label>
                          <input type="text" list="listaPontosAcesso" name="pontoAcesso2" value={formData.pontoAcesso2} onChange={handleChange} className="w-full border-[2px] border-black p-2 text-sm font-bold focus:outline-none focus:bg-gray-50" />
                        </div>
                      </div>
                    </div>
                  </details>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 bg-[#f8bbd0] p-4 md:p-6 border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Tipo Documental</label>
                    <input type="text" list="listaTipos" name="tipoDocumental" value={formData.tipoDocumental} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm font-bold focus:outline-none focus:bg-white" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Série Documental</label>
                    <input type="text" list="listaSeries" name="serie" value={formData.serie} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm font-bold focus:outline-none focus:bg-white" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">Data do Documento (Texto Livre) *</label>
                    <input required type="text" name="dataDocumento" value={formData.dataDocumento} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm font-black focus:outline-none focus:bg-white uppercase" placeholder="Ex: 1998, 2010-05, 1990 ~ 2000" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Código de Classificação IFES/SIGA</label>
                    <input type="text" list="codigosSiga" name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[3px] border-black p-3 text-sm font-bold focus:outline-none focus:bg-white" placeholder="Selecione ou digite..." />
                  </div>
                  <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Observações</label>
                    <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[3px] border-black p-3 text-sm font-bold focus:outline-none focus:bg-white resize-none" />
                  </div>
                </div>

                <button type="submit" disabled={status === 'loading'} className="mt-2 w-full bg-[#c2185b] text-white border-[4px] md:border-[6px] border-black py-4 md:py-5 font-black text-xl md:text-3xl uppercase tracking-wider hover:bg-[#d81b60] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-y-1 disabled:translate-x-1">
                  {status === 'loading' ? 'Verificando...' : 'Revisar Informações'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* VER ACERVO */}
        {activeTab === 'acervo' && (
          <div className="p-4 md:p-8 flex flex-col bg-white min-h-[500px]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
               <h2 className="text-xl md:text-2xl font-black uppercase tracking-widest text-[#c2185b]">Inventário do Acervo</h2>
               <div className="flex border-[4px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white w-full md:w-auto">
                 <button onClick={() => setViewMode('list')} className={`flex-1 md:flex-none px-4 py-3 font-black uppercase text-xs transition-colors ${viewMode === 'list' ? 'bg-[#ffb300] text-black' : 'text-gray-500 hover:bg-gray-100'}`}>Tabela</button>
                 <div className="w-[4px] bg-black"></div>
                 <button onClick={() => setViewMode('card')} className={`flex-1 md:flex-none px-4 py-3 font-black uppercase text-xs transition-colors ${viewMode === 'card' ? 'bg-[#ffb300] text-black' : 'text-gray-500 hover:bg-gray-100'}`}>Cards</button>
               </div>
            </div>

            {fetchError && (
              <div className="mb-6 bg-red-200 border-[4px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="font-black text-red-900 uppercase text-sm">⚠ Erro:</p><p className="font-bold text-xs mt-1">{fetchError}</p>
              </div>
            )}
            
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center min-h-[300px]">
                <p className="font-black text-lg md:text-2xl uppercase animate-pulse text-[#00bcd4]">Consultando Banco de Dados...</p>
              </div>
            ) : sortedItems.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-6 md:p-10 bg-gray-50 border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="font-black text-sm md:text-xl uppercase text-gray-400 text-center">O Acervo está Vazio.</p>
              </div>
            ) : viewMode === 'list' ? (
              <div className="border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                <div className="max-h-[60vh] overflow-x-auto overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#00bcd4] text-black shadow-sm">
                        {["Data de análise", "ID Item", "Centro", "Origem", "Produtor", "Escopo e Conteúdo", "Data doc", "Código Class."].map((header) => (
                          <th key={header} onClick={() => handleSort(header === "Data doc" ? "Data do documento" : header === "Código Class." ? "Código de Classificação" : header)} className="border-b-[4px] md:border-b-[6px] border-r-[3px] border-black p-3 md:p-4 font-black uppercase text-[9px] md:text-xs cursor-pointer hover:bg-cyan-300 last:border-r-0 whitespace-nowrap">
                            {header} {sortConfig.key === (header === "Data doc" ? "Data do documento" : header === "Código Class." ? "Código de Classificação" : header) && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-gray-50">
                        {sortedItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-yellow-100 border-b-[3px] border-black last:border-b-0 text-xs md:text-sm">
                            <td className="p-3 font-mono text-[9px] border-r-[3px] border-black whitespace-nowrap">{cleanDateTimeStr(item["Data de análise"])}</td>
                            <td className="p-3 font-black text-[#c2185b] border-r-[3px] border-black whitespace-nowrap">{item["ID Item"]}</td>
                            <td className="p-3 font-bold border-r-[3px] border-black truncate max-w-[60px] md:max-w-[80px]">
                                <span onClick={() => setModalFilter({key: 'Centro', value: item["Centro"], label: 'Centro'})} className="cursor-pointer hover:bg-cyan-200 px-1 rounded transition-colors inline-block" title="Filtrar por Centro">{item["Centro"]}</span>
                            </td>
                            <td className="p-3 font-bold border-r-[3px] border-black truncate max-w-[80px] md:max-w-[120px]">
                                <span onClick={() => setModalFilter({key: 'Origem', value: item["Origem"], label: 'Origem'})} className="cursor-pointer hover:bg-cyan-200 px-1 rounded transition-colors inline-block" title="Filtrar por Origem">{item["Origem"]}</span>
                            </td>
                            <td className="p-3 font-bold border-r-[3px] border-black truncate max-w-[100px] md:max-w-[150px]">
                                <span onClick={() => setModalFilter({key: 'Produtor', value: item["Produtor"], label: 'Produtor'})} className="cursor-pointer hover:bg-cyan-200 px-1 rounded transition-colors inline-block" title="Filtrar por Produtor">{item["Produtor"]}</span>
                            </td>
                            <td className="p-3 font-bold border-r-[3px] border-black min-w-[150px] md:min-w-[200px]" title={item["Escopo e Conteúdo"]}>{item["Escopo e Conteúdo"]?.substring(0,60)}{(item["Escopo e Conteúdo"]?.length > 60 ? '...' : '')}</td>
                            <td className="p-3 font-black border-r-[3px] border-black bg-[#ffe082] whitespace-nowrap">
                                {cleanDateStr(item["Data do documento"])}
                            </td>
                            <td className="p-2 md:p-3">
                                {(item["Código de Classificação"] || item["Código de Classification"]) ? (
                                    <button onClick={() => setModalFilter({key: 'Código de Classificação', value: item["Código de Classificação"] || item["Código de Classification"], label: 'Código de Classificação'})} className="text-[9px] md:text-[10px] font-black uppercase bg-[#e0f7fa] border-[2px] border-black px-2 py-1 text-cyan-800 hover:bg-cyan-200 transition-colors truncate max-w-[120px] md:max-w-[150px] block" title={item["Código de Classificação"] || item["Código de Classification"]}>
                                        🏷️ {item["Código de Classificação"] || item["Código de Classification"]}
                                    </button>
                                ) : '--'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 animate-in fade-in duration-300">
                 {sortedItems.map((item, idx) => (
                    <div key={idx} className="border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] bg-white flex flex-col h-full hover:-translate-y-1 hover:-translate-x-1 transition-transform">
                       <div className="p-3 bg-[#c2185b] border-b-[4px] border-black flex justify-between items-center text-white">
                           <span className="font-black text-base md:text-lg tracking-wider">{item["ID Item"]}</span>
                           <span className="font-mono text-[9px] md:text-[10px] bg-black px-2 py-1">{cleanDateStr(item["Data do documento"])}</span>
                       </div>
                       <div className="p-4 flex-1 flex flex-col gap-2">
                           <div className="flex gap-2 font-bold text-[10px] md:text-xs uppercase tracking-widest text-gray-500 mb-2">
                              <span onClick={() => setModalFilter({key: 'Centro', value: item["Centro"], label: 'Centro'})} className="bg-[#ffe082] text-black px-2 py-0.5 border-[2px] border-black cursor-pointer hover:bg-yellow-400">{item["Centro"]}</span>
                              <span onClick={() => setModalFilter({key: 'Origem', value: item["Origem"], label: 'Origem'})} className="truncate cursor-pointer hover:underline hover:text-black">{item["Origem"]}</span>
                           </div>
                           <h3 className="font-black text-sm md:text-base leading-tight">{item["Escopo e Conteúdo"]}</h3>
                           <div className="text-xs md:text-sm font-bold text-gray-700 mt-2 border-t-[2px] border-dotted border-gray-300 pt-2"><span className="opacity-60 text-[10px] uppercase">Produtor:</span> <span onClick={() => setModalFilter({key: 'Produtor', value: item["Produtor"], label: 'Produtor'})} className="cursor-pointer hover:text-black hover:underline">{item["Produtor"] || '--'}</span></div>
                           
                           {(item["Tipo Documental"] || item["Série"]) && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                 {item["Tipo Documental"] && <span onClick={() => setModalFilter({key: 'Tipo Documental', value: item["Tipo Documental"], label: 'Tipo Documental'})} className="text-[9px] font-bold bg-gray-200 px-1 border border-black cursor-pointer hover:bg-gray-300">{item["Tipo Documental"]}</span>}
                                 {item["Série"] && <span onClick={() => setModalFilter({key: 'Série', value: item["Série"], label: 'Série'})} className="text-[9px] font-bold bg-gray-200 px-1 border border-black cursor-pointer hover:bg-gray-300">{item["Série"]}</span>}
                              </div>
                           )}
                       </div>
                       <div className="p-3 bg-gray-100 border-t-[4px] border-black flex flex-col gap-1 text-[9px] md:text-[10px] font-black uppercase">
                           {(item["Código de Classificação"] || item["Código de Classification"]) ? (
                               <button onClick={() => setModalFilter({key: 'Código de Classificação', value: item["Código de Classificação"] || item["Código de Classification"], label: 'Código de Classificação'})} className="bg-white border-[2px] border-black px-2 py-1.5 text-cyan-800 hover:bg-cyan-100 transition-colors text-left truncate" title="Filtrar por Código">
                                  🏷️ {item["Código de Classificação"] || item["Código de Classification"]}
                               </button>
                           ) : <span className="opacity-50">Sem Código</span>}
                       </div>
                    </div>
                 ))}
              </div>
            )}
          </div>
        )}

        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="p-4 md:p-8 flex flex-col bg-[#e0f7fa] min-h-[500px]">
            {loadingList ? (
               <div className="flex-1 flex items-center justify-center">
                 <p className="font-black text-lg md:text-2xl uppercase animate-pulse text-[#00bcd4]">Processando Estatísticas...</p>
               </div>
            ) : items.length === 0 ? (
               <div className="flex-1 flex items-center justify-center p-6 md:p-10 bg-white border-[4px] md:border-[6px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                 <p className="font-black text-sm md:text-xl uppercase text-gray-400 text-center">Acervo vazio. Registre itens para ver os gráficos.</p>
               </div>
            ) : (
               <div className="flex flex-col gap-6 animate-in fade-in duration-500">
                 
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                   <div className="w-full">
                     <PieChart data={dashboardStats.origem} title="Acervo por Origem" onFilter={(key, val) => setModalFilter({key, value: val, label: key})} />
                   </div>
                   <div className="w-full">
                     <PieChart data={dashboardStats.decada} title="Acervo por Décadas" onFilter={(key, val) => setModalFilter({key, value: val, label: 'Década'})} />
                   </div>
                 </div>

                 <div className="grid grid-cols-1 gap-6">
                   <div className="w-full">
                     <BarChart data={dashboardStats.mesAno} title="Acervo Mês a Mês" color="#c2185b" onFilter={(key, val) => setModalFilter({key, value: val, label: 'Data'})} />
                   </div>
                   <div className="w-full">
                     <BarChart data={dashboardStats.ano} title="Acervo Ano a Ano" color="#ffb300" onFilter={(key, val) => setModalFilter({key, value: val, label: 'Ano'})} />
                   </div>
                 </div>

                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   <div className="w-full lg:col-span-1">
                     <PieChart data={dashboardStats.codigo} title="Códigos Analisados" onFilter={(key, val) => setModalFilter({key: 'Código de Classificação', value: val, label: 'Código'})} />
                   </div>
                   <div className="w-full lg:col-span-2">
                     <BarChart data={dashboardStats.codigo} title="Volume por Código de Classificação" color="#00bcd4" onFilter={(key, val) => setModalFilter({key: 'Código de Classificação', value: val, label: 'Código'})} />
                   </div>
                 </div>

               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
