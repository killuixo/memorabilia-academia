import React, { useState, useEffect, useRef } from 'react';

const getGoogleScriptUrl = () => {
  try {
    return import.meta.env.VITE_GOOGLE_SCRIPT_URL || "";
  } catch (error) {
    return ""; 
  }
};
const GOOGLE_SCRIPT_URL = getGoogleScriptUrl();

export default function App() {
  const [activeTab, setActiveTab] = useState('registro'); 
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data/Hora', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const initialFormState = {
    pacote: '', idItem: '', centro: '', departamento: '',
    estudante1: '', estudante2: '', estudante3: '', orientador: '',
    curso: '', mesAno: '', codigo: '', observacoes: ''
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
        if (Array.isArray(data)) {
           setItems(data);
        } else {
           setFetchError("Erro: A resposta não é uma lista válida.");
        }
      } catch(e) {
        setFetchError("Erro: A planilha não retornou JSON válido.");
      }
    } catch (err) {
      setFetchError("Falha de comunicação com o servidor.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (activeTab === 'acervo') fetchItems();
  }, [activeTab]);

  useEffect(() => {
    if (items.length === 0) return;

    const lastItem = items[items.length - 1]; // Pega a última linha inserida na planilha

    setFormData(prev => {
      let updates = {};

      // Mantém a sugestão do último ID Pacote
      const autoPacote = lastItem["ID Pacote"] || '';
      if (!prev.pacote && autoPacote) updates.pacote = autoPacote;

      // LÓGICA DO ID ITEM: Pega o último exato (ex: REL-CFH-008) e soma +1 (REL-CFH-009)
      const lastIdItem = lastItem["ID Item"] || '';
      if (lastIdItem && (!prev.idItem || prev.idItem === lastIdItem)) {
        // Separa o texto/hífen dos números finais
        const match = lastIdItem.match(/^(.*-)(\d+)$/);
        if (match) {
          const prefix = match[1]; // Ex: "REL-CFH-"
          const numStr = match[2]; // Ex: "008"
          const nextNum = parseInt(numStr, 10) + 1; // 9
          updates.idItem = `${prefix}${String(nextNum).padStart(numStr.length, '0')}`; // "REL-CFH-009"
        }
      }

      if (Object.keys(updates).length > 0) {
          return { ...prev, ...updates };
      }
      return prev;
    });

  }, [items]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const loadTesseract = () => {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const parseOCR = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let parsed = { centro: '', departamento: '', curso: '', orientador: '', mesAno: '', estudantes: [] };
    let captureStudents = false;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const lowerLine = originalLine.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");

      // Centro e Depto básicos
      if (!parsed.centro && (lowerLine.includes('cce') || lowerLine.includes('comunicacao e expressao'))) parsed.centro = 'CCE';
      if (!parsed.centro && (lowerLine.includes('cfh') || lowerLine.includes('filosofia e historia'))) parsed.centro = 'CFH';
      if (!parsed.departamento && (lowerLine.includes('llv') || lowerLine.includes('vernaculas'))) parsed.departamento = 'LLV';
      if (!parsed.departamento && (lowerLine.includes('men') || lowerLine.includes('metodologia de ensino'))) parsed.departamento = 'MEN';
      
      // Disciplina
      if (!parsed.curso && lowerLine.includes('disciplina:')) {
        parsed.curso = originalLine.replace(/.*?disciplina:\s*/i, '').trim();
      }
      
      // Orientador / Professor
      if (!parsed.orientador && (lowerLine.match(/prof(a|essor|essora|ª|\.)?:/i) || lowerLine.includes('orientador'))) {
        parsed.orientador = originalLine.replace(/.*?(prof(a|essor|essora|ª|\.)?|orientador(a)?)\s*[:\-]?\s*/i, '').replace(/^[^a-zA-ZÀ-ÿ]+/, '').trim();
        continue;
      }

      // Acadêmicos (Inicia a captura das próximas linhas)
      if (lowerLine.includes('academicos:') || lowerLine.includes('alunos:')) {
         captureStudents = true;
         let inlineName = originalLine.replace(/.*?(academicos|alunos)\s*[:\-]?\s*/i, '').trim();
         if (inlineName.length > 3) parsed.estudantes.push(inlineName);
         continue;
      }

      // Parar captura se achar Cidade ou Mês
      const matchDate = lowerLine.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).*?(19\d{2}|20\d{2})/);
      if (matchDate) {
        captureStudents = false;
        const monthMap = {janeiro:'01', fevereiro:'02', marco:'03', abril:'04', maio:'05', junho:'06', julho:'07', agosto:'08', setembro:'09', outubro:'10', novembro:'11', dezembro:'12'};
        parsed.mesAno = `${matchDate[2]}-${monthMap[matchDate[1]]}`;
        continue;
      }

      if (lowerLine.includes('florianopolis')) {
         captureStudents = false;
         continue;
      }

      // Captura Estudante 2 e Estudante 3 nas linhas debaixo de Acadêmicos
      if (captureStudents && parsed.estudantes.length < 3) {
         let nome = originalLine.replace(/^[^a-zA-ZÀ-ÿ]+/, '').trim(); 
         if (nome.length > 4 && !nome.includes('"')) {
             parsed.estudantes.push(nome);
         }
      }
    }

    return parsed;
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, 'por');
      
      const parsed = parseOCR(result.data.text);
      
      setFormData(prev => ({
        ...prev,
        centro: parsed.centro || prev.centro,
        departamento: parsed.departamento || prev.departamento,
        curso: parsed.curso || prev.curso,
        orientador: parsed.orientador || prev.orientador,
        mesAno: parsed.mesAno || prev.mesAno,
        estudante1: parsed.estudantes[0] || prev.estudante1,
        estudante2: parsed.estudantes[1] || prev.estudante2,
        estudante3: parsed.estudantes[2] || prev.estudante3,
      }));
      
      setOcrStatus('success');
      setTimeout(() => setOcrStatus('idle'), 4000);
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
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      setFormData(prev => ({
        ...initialFormState,
        pacote: prev.pacote,
        centro: prev.centro,
        departamento: prev.departamento,
        idItem: prev.idItem 
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

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-6 px-4 font-sans selection:bg-[#ffb300]">
      <div className="w-full max-w-6xl bg-white border-[8px] md:border-[12px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] md:shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        <div className="flex flex-col md:flex-row border-b-[8px] md:border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-6 md:p-8 text-white border-b-[8px] md:border-b-0 md:border-r-[12px] border-black">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter">Acervo MEN</h1>
            <p className="mt-1 text-pink-200 font-bold text-base md:text-lg">Triagem de Relatórios de Estágio</p>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300] min-w-[250px]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-4 md:px-8 py-4 font-black uppercase tracking-wider text-sm md:text-xl border-b-[8px] md:border-b-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-4 md:px-8 py-4 font-black uppercase tracking-wider text-sm md:text-xl transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Ver Acervo
            </button>
          </div>
        </div>

        {activeTab === 'registro' && (
          <div className="flex flex-col bg-white p-6 md:p-10 relative">

            {}
            <div className="flex justify-end mb-4">
               <button 
                 type="button"
                 onClick={() => fileInputRef.current.click()}
                 className="flex items-center gap-2 px-4 py-2 bg-black text-white font-bold text-sm uppercase tracking-wider hover:bg-gray-800 transition-colors rounded-sm"
               >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                 {ocrStatus === 'loading' ? 'Lendo Capa...' : 'Ler Capa'}
               </button>
               <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
            </div>

            {/* Datalist para Códigos IFES */}
            <datalist id="codigosSiga">
              <option value="125.31 - Provas. Exames. Trabalhos" />
              <option value="125.41 - Histórico escolar. Integralização curricular" />
              <option value="125.42 - Emissão de diploma" />
              <option value="125.43 - Assentamentos individuais dos alunos (Dossiês)" />
            </datalist>

            {ocrStatus === 'success' && <div className="mb-4 p-2 bg-[#00bcd4] border-[3px] border-black font-black text-xs uppercase text-center text-black">✓ Informações capturadas com sucesso!</div>}
            {ocrStatus === 'error' && <div className="mb-4 p-2 bg-[#c2185b] border-[3px] border-black font-black text-xs uppercase text-center text-white">⚠ Não foi possível ler a imagem com clareza.</div>}

            {showConfirm ? (
              <div className="flex flex-col gap-6 animate-in fade-in zoom-in duration-300">
                <h2 className="text-3xl font-black uppercase text-[#c2185b] mb-2 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm md:text-base">
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Departamento:</strong> <br/>{formData.departamento || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Estudantes:</strong> <br/>{[formData.estudante1, formData.estudante2, formData.estudante3].filter(Boolean).join(' | ') || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Mês/Ano:</strong> <br/>{formData.mesAno || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Código SIGA:</strong> <br/>{formData.codigo || '-'}</div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 mt-4">
                   <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-cyan-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Salvar na Planilha</button>
                   <button onClick={() => setShowConfirm(false)} className="flex-1 bg-white border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Voltar</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handlePreSubmit} className="flex flex-col gap-8">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#e0f7fa] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">ID Pacote</label>
                    <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-white uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b]">ID Item</label>
                    <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-[#f8bbd0] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#ffe082] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Centro</label>
                    <input required type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Departamento</label>
                    <input required type="text" name="departamento" value={formData.departamento} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Disciplina (Opcional)</label>
                    <input type="text" name="curso" value={formData.curso} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">Orientador(a) (Opcional)</label>
                    <input type="text" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t-[4px] border-black border-dashed">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Estudante 1</label>
                      <input required type="text" name="estudante1" value={formData.estudante1} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 2 (Opcional)</label>
                      <input type="text" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 3 (Opcional)</label>
                      <input type="text" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#f8bbd0] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Mês e Ano</label>
                    <input required type="month" name="mesAno" value={formData.mesAno} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg focus:outline-none focus:bg-white uppercase font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Código SIGA / IFES</label>
                    <input type="text" list="codigosSiga" name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Observações (Opcional)</label>
                    <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white resize-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <button type="submit" disabled={status === 'loading'} className="mt-2 w-full bg-[#c2185b] text-white border-[6px] border-black py-5 font-black text-2xl md:text-3xl uppercase tracking-wider hover:bg-[#d81b60] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
                  {status === 'loading' ? 'Enviando...' : 'Revisar Informações'}
                </button>
                {status === 'success' && <div className="bg-[#00bcd4] border-[6px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"><p className="text-black font-black text-center text-xl uppercase">✓ Salvo na Planilha!</p></div>}
              </form>
            )}
          </div>
        )}

        {}
        {activeTab === 'acervo' && (
          <div className="p-6 md:p-8 flex flex-col bg-white overflow-hidden min-h-[500px]">
            {fetchError && (
              <div className="mb-6 bg-red-200 border-[4px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="font-black text-red-900 uppercase">⚠ Erro:</p><p className="font-bold text-sm mt-1">{fetchError}</p>
              </div>
            )}
            
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-black text-2xl uppercase animate-pulse">Consultando Planilha...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-[6px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#00bcd4] text-black">
                      {["Data/Hora", "ID Pacote", "ID Item", "Centro", "Departamento", "Estudante 1", "Orientador", "Mês/Ano"].map((header) => (
                        <th key={header} onClick={() => handleSort(header)} className="border-b-[6px] border-r-[4px] border-black p-4 font-black uppercase text-sm cursor-pointer hover:bg-cyan-300 last:border-r-0">
                          {header} {sortConfig.key === header && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-gray-50">
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="8" className="p-8 text-center font-bold text-gray-500 uppercase">O Acervo está Vazio.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-yellow-100 border-b-[4px] border-black last:border-b-0">
                          <td className="p-4 font-mono text-xs border-r-[4px] border-black">{item["Data/Hora"]}</td>
                          <td className="p-4 font-black border-r-[4px] border-black">{item["ID Pacote"]}</td>
                          <td className="p-4 font-black text-[#c2185b] border-r-[4px] border-black">{item["ID Item"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Centro"]?.substring(0,25)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Departamento"]?.substring(0,10)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Estudante 1"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Orientador"]}</td>
                          <td className="p-4 font-black bg-[#ffe082]">{item["Mês/Ano"]}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
